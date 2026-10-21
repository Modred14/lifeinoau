// components/CharacterViewer.js
"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { lookKey } from "@/lib/look.js";

// Where the camera sits relative to what it looks at (a metre-scale offset, scaled to the distance), and how much of the figure must stay in view.
const TARGET_Y = 0.8, VIEW = [Math.sin(0.35), 0.25 / 4.25, Math.cos(0.35)], BASE_DIST = 4.25, HALF_BODY = 0.62;

/** A 3D character you can spin: drag, use the buttons, or the arrow keys. `look` and `gender` update live; the character is rebuilt only when the look really changes. */
export default function CharacterViewer({ look, gender = "F", className = "", style, hint = true, autoSpin = true, label }) {
  const box = useRef(null), api = useRef(null), latest = useRef({ look, gender });
  const [failed, setFailed] = useState(false);
  latest.current = { look, gender };
  const key = lookKey(look, gender); // the same content in a new object does not rebuild anyone

  useEffect(() => {
    let alive = true, stage = null, cur = null, ro = null, touched = false;
    (async () => {
      try {
        const [{ createStage }, { addCharacterLights }, { createAvatar }, THREE] = await Promise.all([import("../lib3d/stage.js"), import("../lib3d/character.js"), import("../lib3d/avatar/loadAvatar.js"), import("three")]);
        if (!alive) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        stage = createStage(box.current.querySelector("[data-canvas]"), { alpha: true, fov: 30, controls: { enablePan: false, minDistance: 2.2, maxDistance: 6, minPolarAngle: 1.05, maxPolarAngle: 1.7, autoRotate: autoSpin && !reduce, autoRotateSpeed: 1.1 } });
        const el = stage.renderer.domElement;
        el.style.touchAction = "pan-y"; // a finger that starts on the preview can still scroll the page up and down; sideways drags spin the character
        el.addEventListener("webglcontextlost", (e) => e.preventDefault()); // lets the browser give the graphics context back (phones take it away when the tab is in the background)
        stage.scene.background = null; stage.renderer.setClearColor(0x000000, 0); addCharacterLights(stage.scene);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.06, 72), new THREE.MeshStandardMaterial({ color: 0x1c2738, roughness: 0.85 })); disc.position.y = -0.03; disc.receiveShadow = true; stage.scene.add(disc);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: 0x3fd08a })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.003; stage.scene.add(ring);
        // Camera framing: the whole figure stays in view whatever shape the box is (a tall narrow phone screen needs the camera further back than a wide desktop panel).
        // It follows the box until the person zooms or turns it themselves.
        stage.controls.target.set(0, TARGET_Y, 0);
        const fit = () => {
          const w = el.clientWidth || 1, h = el.clientHeight || 1, tan = Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2));
          const dist = Math.min(9, Math.max(BASE_DIST, HALF_BODY / (tan * (w / h))));
          stage.controls.maxDistance = Math.max(6, dist * 1.4);
          if (!touched) stage.camera.position.set(VIEW[0] * dist, TARGET_Y + VIEW[1] * dist, VIEW[2] * dist);
          stage.controls.update();
        };
        stage.controls.addEventListener("start", () => { touched = true; });
        fit();
        let ticket = 0; // only the newest request may put a character on stage
        const set = async (lk, g) => {
          const mine = ++ticket;
          try {
            const next = await createAvatar(lk, g);
            if (!alive || mine !== ticket) { next.dispose(); return; }
            if (cur) { stage.scene.remove(cur.root); cur.dispose(); }
            cur = next; stage.scene.add(cur.root);
          } catch (e) { console.error("could not build the preview character", e); if (alive && mine === ticket) setFailed(true); }
        };
        stage.onFrame((t, dt) => { if (cur && !reduce) cur.update(t, dt); });
        set(latest.current.look, latest.current.gender); api.current = { stage, set, touch: () => { touched = true; } };
        ro = new ResizeObserver(() => { stage.resize(); fit(); }); ro.observe(box.current);
      } catch (e) { console.error("3D preview unavailable", e); if (alive) setFailed(true); }
    })();
    return () => { alive = false; ro?.disconnect(); cur?.dispose(); stage?.dispose(); api.current = null; };
  }, [autoSpin]);

  useEffect(() => { api.current?.set(latest.current.look, latest.current.gender); }, [key]);

  const nudge = (o) => { api.current?.touch(); api.current?.stage.nudge(o); }; // the buttons count as the person taking over the camera, like dragging
  const onKey = (e) => { const k = e.key; if (k === "ArrowLeft") nudge({ az: -0.3 }); else if (k === "ArrowRight") nudge({ az: 0.3 }); else if (k === "+" || k === "=") nudge({ zoom: 0.88 }); else if (k === "-") nudge({ zoom: 1.14 }); else return; e.preventDefault(); };
  const l = look ?? {}, desc = label ?? `3D preview: ${gender === "F" ? "woman" : "man"} with ${l.hair ?? "short"} hair in a ${l.outfit ?? "casual"} outfit.`;
  return (
    <div ref={box} className={"stage " + className} style={style} tabIndex={0} role="group" aria-label={`${desc} Drag to spin, or use the arrow keys. Plus and minus zoom.`} data-failed={failed ? "1" : undefined} onKeyDown={onKey}>
      <div data-canvas style={{ position: "absolute", inset: 0 }} />
      {failed ? (
        <p className="stage-hint" role="status">The 3D preview is not available on this device. You can still choose your look; your character is saved exactly as chosen.</p>
      ) : (
        <>
          <div className="stage-ctrls">
            <button type="button" aria-label="Rotate left" onClick={() => nudge({ az: -0.5 })}><Icon name="rotateLeft" /></button>
            <button type="button" aria-label="Rotate right" onClick={() => nudge({ az: 0.5 })}><Icon name="rotateRight" /></button>
            <button type="button" aria-label="Zoom in" onClick={() => nudge({ zoom: 0.85 })}><Icon name="plus" /></button>
            <button type="button" aria-label="Zoom out" onClick={() => nudge({ zoom: 1.18 })}><Icon name="minus" /></button>
          </div>
          {hint && <span className="stage-hint">Drag to spin</span>}
        </>
      )}
    </div>
  );
}
