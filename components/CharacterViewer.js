// components/CharacterViewer.js
"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

/** A 3D character you can spin: drag, use the buttons, or the arrow keys. `look` and `gender` update live. */
export default function CharacterViewer({ look, gender = "F", className = "", style, hint = true, autoSpin = true, label }) {
  const box = useRef(null), api = useRef(null), latest = useRef({ look, gender });
  latest.current = { look, gender };

  useEffect(() => {
    let alive = true, stage = null, cur = null, ro = null;
    (async () => {
      try {
        const [{ createStage }, { buildCharacter, addCharacterLights }, THREE] = await Promise.all([import("../lib3d/stage.js"), import("../lib3d/character.js"), import("three")]);
        if (!alive) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        stage = createStage(box.current.querySelector("[data-canvas]"), { alpha: true, fov: 30, controls: { enablePan: false, minDistance: 2.2, maxDistance: 6, minPolarAngle: 1.05, maxPolarAngle: 1.7, autoRotate: autoSpin && !reduce, autoRotateSpeed: 1.1 } });
        stage.scene.background = null; stage.renderer.setClearColor(0x000000, 0); addCharacterLights(stage.scene);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.06, 72), new THREE.MeshStandardMaterial({ color: 0x1c2738, roughness: 0.85 })); disc.position.y = -0.03; disc.receiveShadow = true; stage.scene.add(disc);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: 0x3fd08a })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.003; stage.scene.add(ring);
        stage.controls.target.set(0, 0.8, 0); stage.camera.position.set(Math.sin(0.35) * 4.25, 1.05, Math.cos(0.35) * 4.25); stage.controls.update();
        const set = (lk, g) => { if (cur) { stage.scene.remove(cur.root); cur.dispose(); } cur = buildCharacter(lk, g); stage.scene.add(cur.root); };
        stage.onFrame((t) => { if (cur && !reduce) cur.update(t); });
        set(latest.current.look, latest.current.gender); api.current = { stage, set };
        ro = new ResizeObserver(() => stage.resize()); ro.observe(box.current);
      } catch (e) { console.error("3D preview unavailable", e); if (box.current) box.current.dataset.failed = "1"; }
    })();
    return () => { alive = false; ro?.disconnect(); cur?.dispose(); stage?.dispose(); api.current = null; };
  }, [autoSpin]);

  useEffect(() => { api.current?.set(look, gender); }, [look, gender]);

  const nudge = (o) => api.current?.stage.nudge(o);
  const onKey = (e) => { const k = e.key; if (k === "ArrowLeft") nudge({ az: -0.3 }); else if (k === "ArrowRight") nudge({ az: 0.3 }); else if (k === "+" || k === "=") nudge({ zoom: 0.88 }); else if (k === "-") nudge({ zoom: 1.14 }); else return; e.preventDefault(); };
  const l = look ?? {}, desc = label ?? `3D preview: ${gender === "F" ? "woman" : "man"} with ${l.hair ?? "short"} hair in a ${l.outfit ?? "casual"} outfit.`;
  return (
    <div ref={box} className={"stage " + className} style={style} tabIndex={0} role="group" aria-label={`${desc} Drag to spin, or use the arrow keys. Plus and minus zoom.`} onKeyDown={onKey}>
      <div data-canvas style={{ position: "absolute", inset: 0 }} />
      <div className="stage-ctrls">
        <button type="button" aria-label="Rotate left" onClick={() => nudge({ az: -0.5 })}><Icon name="rotateLeft" /></button>
        <button type="button" aria-label="Rotate right" onClick={() => nudge({ az: 0.5 })}><Icon name="rotateRight" /></button>
        <button type="button" aria-label="Zoom in" onClick={() => nudge({ zoom: 0.85 })}><Icon name="plus" /></button>
        <button type="button" aria-label="Zoom out" onClick={() => nudge({ zoom: 1.18 })}><Icon name="minus" /></button>
      </div>
      {hint && <span className="stage-hint">Drag to spin</span>}
    </div>
  );
}
