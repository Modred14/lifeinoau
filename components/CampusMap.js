// components/CampusMap.js
"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { Icon, KIND_ICON } from "./Icon";

const MAJOR = new Set(["hall", "library", "gate", "club", "hostel"]);
const HOME_VIEW = { x: 0, z: 14, dist: 215, az: 0.7, pol: 0.95 };

/** The 3D OAU campus. interactive=false gives a slowly turning backdrop (landing page). Pins are real buttons. */
export default function CampusMap({ interactive = true, pins = true, autoRotate = false, selectedId = null, onSelect, className = "", style, view = HOME_VIEW }) {
  const box = useRef(null), api = useRef(null), [mounts, setMounts] = useState([]), [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true, stage = null, campus = null, lab = null, ro = null;
    (async () => {
      try {
        const [{ createStage }, { buildCampus, addCampusLighting }, { CSS2DRenderer, CSS2DObject }] = await Promise.all([import("../lib3d/stage.js"), import("../lib3d/campus.js"), import("three/addons/renderers/CSS2DRenderer.js")]);
        if (!alive) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches, host = box.current.querySelector("[data-canvas]");
        stage = createStage(host, { fov: 42, far: 900, controls: { maxPolarAngle: 1.38, minPolarAngle: 0.35, minDistance: 28, maxDistance: 330, enablePan: interactive, enableRotate: interactive, enableZoom: interactive, autoRotate: autoRotate && !reduce, autoRotateSpeed: 0.45, screenSpacePanning: false } });
        addCampusLighting(stage.scene); campus = buildCampus(); stage.scene.add(campus.root); stage.onFrame((t, dt) => { if (!reduce) campus.update(t, dt); });
        const { x, z, dist, az, pol } = view; stage.controls.target.set(x, 0, z); stage.camera.position.set(x + Math.sin(az) * Math.sin(pol) * dist, Math.cos(pol) * dist, z + Math.cos(az) * Math.sin(pol) * dist); stage.controls.update();
        if (!interactive) stage.renderer.domElement.style.pointerEvents = "none";
        // pins: HTML buttons that follow 3D positions
        if (pins) {
          lab = new CSS2DRenderer(); lab.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden"; host.appendChild(lab.domElement);
          const list = LANDMARKS.map((L) => { const el = document.createElement("div"); el.style.pointerEvents = "auto"; const o = new CSS2DObject(el); o.position.copy(campus.anchors.get(L.id)); stage.scene.add(o); return { id: L.id, el }; });
          setMounts(list); const size = () => lab.setSize(box.current.clientWidth, box.current.clientHeight); size(); ro = new ResizeObserver(size); ro.observe(box.current);
          let zoom = ""; stage.onAfterRender(() => { lab.render(stage.scene, stage.camera); const z2 = stage.camera.position.distanceTo(stage.controls.target) > 150 ? "far" : "near"; if (z2 !== zoom) { zoom = z2; box.current.dataset.zoom = z2; } });
        }
        api.current = { stage, campus, view, THREE: stage.THREE }; api.current.apply?.();
        box.current.dataset.ready = "1";
      } catch (e) { console.error("3D map unavailable", e); if (alive) setFailed(true); }
    })();
    return () => { alive = false; ro?.disconnect(); campus?.dispose(); lab?.domElement.remove(); stage?.dispose(); api.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const a = api.current; if (!a) return; a.campus.setSelected(selectedId); if (selectedId) { const p = a.campus.anchors.get(selectedId); if (p) a.stage.flyTo(p.x, 0, p.z, 70, 1.0); } }, [selectedId, mounts]);

  const nudge = (o) => api.current?.stage.nudge(o);
  const reset = () => { const v = view; api.current?.stage.flyTo(v.x, 0, v.z, v.dist, v.pol); onSelect?.(null); };
  const onKey = (e) => { const k = e.key; if (k === "ArrowLeft") nudge({ az: -0.25 }); else if (k === "ArrowRight") nudge({ az: 0.25 }); else if (k === "ArrowUp") nudge({ pol: -0.12 }); else if (k === "ArrowDown") nudge({ pol: 0.12 }); else if (k === "+" || k === "=") nudge({ zoom: 0.85 }); else if (k === "-") nudge({ zoom: 1.18 }); else if (k === "Home") reset(); else return; e.preventDefault(); };

  return (
    <div ref={box} className={"stage " + className} style={style} tabIndex={interactive ? 0 : -1} role={interactive ? "group" : "img"} data-zoom="far" onKeyDown={interactive ? onKey : undefined}
      aria-label={interactive ? "Interactive 3D map of the OAU campus and town. Drag to rotate, pinch or scroll to zoom. Arrow keys rotate, plus and minus zoom, Home resets. Every place is also listed under Places." : "A slowly turning 3D view of the OAU campus at dusk."}>
      <div data-canvas style={{ position: "absolute", inset: 0 }} />
      {failed && <p className="mut" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>The 3D map could not start on this device. You can still use Places to see everything.</p>}
      {interactive && !failed && (<>
        <div className="stage-ctrls">
          <button type="button" aria-label="Rotate left" onClick={() => nudge({ az: -0.5 })}><Icon name="rotateLeft" /></button>
          <button type="button" aria-label="Rotate right" onClick={() => nudge({ az: 0.5 })}><Icon name="rotateRight" /></button>
          <button type="button" aria-label="Zoom in" onClick={() => nudge({ zoom: 0.8 })}><Icon name="plus" /></button>
          <button type="button" aria-label="Zoom out" onClick={() => nudge({ zoom: 1.25 })}><Icon name="minus" /></button>
          <button type="button" aria-label="Reset the view" onClick={reset}><Icon name="reset" /></button>
        </div>
      </>)}
      {mounts.map(({ id, el }) => { const L = LANDMARKS.find((l) => l.id === id); return createPortal(
        <button type="button" className="pin" data-kind={L.kind} data-minor={MAJOR.has(L.kind) ? "false" : "true"} aria-pressed={selectedId === id} aria-label={L.name} onClick={() => onSelect?.(id)}>
          <Icon name={KIND_ICON[L.kind]} size={20} /><span className="pinlabel">{L.name}</span></button>, el, id); })}
    </div>
  );
}
