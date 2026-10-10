// components/CampusMap.js
"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { Icon, KIND_ICON } from "./Icon";

const MAJOR = new Set(["hall", "library", "gate", "club", "hostel"]);
const HOME_VIEW = { x: 0, z: 14, dist: 215, az: 0.7, pol: 0.95 };

/**
 * The 3D OAU campus. If public/oau-osm.json exists (real OpenStreetMap data, see docs/MAP-ACCURACY.md) it draws the real roads and
 * buildings and shows only places found in that data. Otherwise it draws the stylised schematic. interactive=false = slow backdrop.
 * onLandmarks(places, info) reports which places are on the map and where they came from.
 */
export default function CampusMap({ interactive = true, pins = true, showControls = interactive, selectedId = null, onSelect, onLandmarks, className = "", style, view = HOME_VIEW }) {
  const box = useRef(null), api = useRef(null), [places, setPlaces] = useState(LANDMARKS), [mounts, setMounts] = useState([]), [failed, setFailed] = useState(false), [credit, setCredit] = useState(null);

  useEffect(() => {
    let alive = true, stage = null, campus = null, lab = null, ro = null;
    (async () => {
      try {
        const osm = await fetch("/oau-osm.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const [{ createStage }, schematic, { CSS2DRenderer, CSS2DObject }] = await Promise.all([import("../lib3d/stage.js"), import("../lib3d/campus.js"), import("three/addons/renderers/CSS2DRenderer.js")]);
        if (!alive) return;
        campus = osm ? (await import("../lib3d/campusOsm.js")).buildOsmCampus(osm) : schematic.buildCampus();
        const list = campus.landmarks ?? LANDMARKS, home = campus.osm ? { ...campus.camera.home, az: view.az, pol: view.pol } : view;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches, host = box.current.querySelector("[data-canvas]");
        stage = createStage(host, { fov: 42, far: Math.max(900, (campus.extent ?? 135) * 8), controls: { maxPolarAngle: 1.38, minPolarAngle: 0.35, minDistance: campus.camera?.min ?? 28, maxDistance: campus.camera?.max ?? 330,
          enablePan: interactive, enableRotate: interactive, enableZoom: interactive, zoomSpeed: 1.1, autoRotate: false, autoRotateSpeed: 0.45, screenSpacePanning: false } });
        if (campus.osm) (await import("../lib3d/campusOsm.js")).addOsmLighting(stage.scene, campus.extent ?? 135); else schematic.addCampusLighting(stage.scene, campus.extent ?? 135);
        stage.scene.add(campus.root); stage.onFrame((t, dt) => { if (!reduce) campus.update(t, dt); });
        const { x, z, dist, az, pol } = home; stage.controls.target.set(x, 0, z); stage.camera.position.set(x + Math.sin(az) * Math.sin(pol) * dist, Math.cos(pol) * dist, z + Math.cos(az) * Math.sin(pol) * dist); stage.controls.update();
        if (pins) {
          lab = new CSS2DRenderer(); lab.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden"; host.appendChild(lab.domElement);
          const made = list.map((L) => { const el = document.createElement("div"); el.style.pointerEvents = "auto"; const o = new CSS2DObject(el); o.position.copy(campus.anchors.get(L.id)); stage.scene.add(o); return { id: L.id, el }; });
          setMounts(made); const size = () => lab.setSize(box.current.clientWidth, box.current.clientHeight); size(); ro = new ResizeObserver(size); ro.observe(box.current);
          let zoom = ""; stage.onAfterRender(() => { lab.render(stage.scene, stage.camera); const z2 = stage.camera.position.distanceTo(stage.controls.target) > (campus.extent ?? 135) * 1.1 ? "far" : "near"; if (z2 !== zoom) { zoom = z2; box.current.dataset.zoom = z2; } });
        }
        api.current = { stage, campus, home, osm: !!campus.osm };
        setPlaces(list); if (campus.osm) setCredit(campus.synthetic ? "TEST DATA ONLY. Not real OAU data." : campus.attribution);
        onLandmarks?.(list, { osm: !!campus.osm, synthetic: !!campus.synthetic, missing: campus.unmatched ?? [] });
        box.current.dataset.ready = "1";
      } catch (e) { console.error("3D map unavailable", e); if (alive) setFailed(true); }
    })();
    return () => { alive = false; ro?.disconnect(); campus?.dispose(); lab?.domElement.remove(); stage?.dispose(); api.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const a = api.current; if (!a) return; a.campus.setSelected(selectedId); if (selectedId) { const p = a.campus.anchors.get(selectedId); if (p) a.stage.flyTo(p.x, 0, p.z, a.osm ? 22 : 70, 1.0); } }, [selectedId, mounts]);

  const nudge = (o) => api.current?.stage.nudge(o);
  const reset = () => { const h = api.current?.home; if (h) api.current.stage.flyTo(h.x, 0, h.z, h.dist, h.pol); onSelect?.(null); };
  const onKey = (e) => { const k = e.key; if (k === "ArrowLeft") nudge({ az: -0.25 }); else if (k === "ArrowRight") nudge({ az: 0.25 }); else if (k === "ArrowUp") nudge({ pol: -0.12 }); else if (k === "ArrowDown") nudge({ pol: 0.12 }); else if (k === "+" || k === "=") nudge({ zoom: 0.85 }); else if (k === "-") nudge({ zoom: 1.18 }); else if (k === "Home") reset(); else return; e.preventDefault(); };

  return (
    <div ref={box} className={"stage " + className} style={style} tabIndex={interactive ? 0 : -1} role={interactive ? "group" : "img"} data-zoom="far" onKeyDown={interactive ? onKey : undefined}
      aria-label={interactive ? "Interactive 3D map of the OAU campus and town. Drag to rotate, pinch or scroll to zoom. Arrow keys rotate, plus and minus zoom, Home resets. Every place is also listed under Places." : "A 3D view of the OAU campus."}>
      <div data-canvas style={{ position: "absolute", inset: 0 }} />
      {failed && <p className="mut" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>The 3D map could not start on this device. You can still use Places to see everything.</p>}
      {credit && <span className="stage-hint" style={{ left: 12, bottom: "calc(var(--nav-h) + var(--safe-b) + 6px)", fontSize: "0.72rem" }}>{credit}</span>}
      {showControls && !failed && (
        <div className="stage-ctrls">
          <button type="button" aria-label="Rotate left" onClick={() => nudge({ az: -0.5 })}><Icon name="rotateLeft" /></button>
          <button type="button" aria-label="Rotate right" onClick={() => nudge({ az: 0.5 })}><Icon name="rotateRight" /></button>
          <button type="button" aria-label="Zoom in" onClick={() => nudge({ zoom: 0.8 })}><Icon name="plus" /></button>
          <button type="button" aria-label="Zoom out" onClick={() => nudge({ zoom: 1.25 })}><Icon name="minus" /></button>
          <button type="button" aria-label="Reset the view" onClick={reset}><Icon name="reset" /></button>
        </div>)}
      {mounts.map(({ id, el }) => { const L = places.find((l) => l.id === id); if (!L) return null; return createPortal(
        <button type="button" className="pin" data-kind={L.kind} data-minor={MAJOR.has(L.kind) ? "false" : "true"} aria-pressed={selectedId === id} aria-label={L.name} onClick={() => onSelect?.(id)}>
          <Icon name={KIND_ICON[L.kind]} size={20} /><span className="pinlabel">{L.name}</span></button>, el, id); })}
    </div>
  );
}