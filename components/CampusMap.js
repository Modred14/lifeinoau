// components/CampusMap.js
"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ICON_OF } from "../lib3d/landmarks.js";
import { loadCampusData, placeMeta } from "../lib3d/campusData.js";
import { Icon } from "./Icon";

const HOME_VIEW = { x: 0, z: 8, dist: 210, az: 0.7, pol: 0.95 };
const labelWidth = (name, tier) => Math.min(190, name.length * (tier === 1 ? 7.4 : 6.4) + 26);

/**
 * The 3D OAU campus, drawn from real footprints and roads (see lib3d/campusReal.js).
 * interactive=false gives a slowly turning backdrop (landing page). Every named building carries a label above its roof;
 * labels are real buttons. They thin out with distance and never overlap, and the "Labels" button hides them all.
 */
export default function CampusMap({ interactive = true, pins = true, autoRotate = false, selectedId = null, onSelect, className = "", style, view = HOME_VIEW }) {
  const box = useRef(null), api = useRef(null), sel = useRef(selectedId), cb = useRef(onSelect), [mounts, setMounts] = useState([]), [failed, setFailed] = useState(false), [labels, setLabels] = useState(true);
  sel.current = selectedId; cb.current = onSelect;

  useEffect(() => {
    let alive = true, stage = null, campus = null, lab = null, ro = null, off = [];
    (async () => {
      try {
        const [{ createStage }, { buildRealCampus, addRealLighting }, { CSS2DRenderer, CSS2DObject }, data] = await Promise.all([import("../lib3d/stage.js"), import("../lib3d/campusReal.js"), import("three/addons/renderers/CSS2DRenderer.js"), loadCampusData()]);
        if (!alive) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches, host = box.current.querySelector("[data-canvas]");
        stage = createStage(host, { fov: 42, far: 1800, controls: { maxPolarAngle: 1.38, minPolarAngle: 0.35, minDistance: 10, maxDistance: 520, enablePan: interactive, enableRotate: interactive, enableZoom: interactive, autoRotate: autoRotate && !reduce, autoRotateSpeed: 0.45, screenSpacePanning: false } });
        const light = addRealLighting(stage.scene); campus = buildRealCampus(data, placeMeta(data)); stage.scene.add(campus.root);
        stage.onFrame((t) => { campus.update(t); light.follow(stage.controls.target); });
        const { x, z, dist, az, pol } = view; stage.controls.target.set(x, 0, z); stage.camera.position.set(x + Math.sin(az) * Math.sin(pol) * dist, Math.cos(pol) * dist, z + Math.cos(az) * Math.sin(pol) * dist); stage.controls.update();
        if (!interactive) stage.renderer.domElement.style.pointerEvents = "none";
        // click a named building to inspect it (a drag is not a click)
        if (interactive) { const el = stage.renderer.domElement, ray = new stage.THREE.Raycaster(), ndc = new stage.THREE.Vector2(); let d0 = null;
          const down = (e) => { d0 = [e.clientX, e.clientY, performance.now()]; };
          const up = (e) => { if (!d0 || Math.hypot(e.clientX - d0[0], e.clientY - d0[1]) > 5 || performance.now() - d0[2] > 500) return; const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, stage.camera); const id = campus.pick(ray); if (id) cb.current?.(id); };
          el.addEventListener("pointerdown", down); el.addEventListener("pointerup", up); off.push(() => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointerup", up); }); }
        // labels: HTML buttons that follow each building's roof
        if (pins) {
          lab = new CSS2DRenderer(); lab.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden"; host.appendChild(lab.domElement);
          const list = campus.places.map((L) => { const el = document.createElement("div"); el.style.pointerEvents = "auto"; const o = new CSS2DObject(el); o.position.copy(L.pos); stage.scene.add(o); return { id: L.id, el, L, w: labelWidth(L.name, L.tier) }; });
          list.sort((a, b) => a.L.tier - b.L.tier); setMounts(list.map(({ id, el }) => ({ id, el, L: campus.places.find((p) => p.id === id) })));
          const size = () => lab.setSize(box.current.clientWidth, box.current.clientHeight); size(); ro = new ResizeObserver(size); ro.observe(box.current);
          const v = new stage.THREE.Vector3(); let frame = 0;
          const declutter = () => { // nearest-first by tier: show a label only if it is on screen, near enough for its tier, and clear of the ones already shown
            const w = box.current.clientWidth, h = box.current.clientHeight, dist = stage.camera.position.distanceTo(stage.controls.target), maxTier = box.current.dataset.labels === "off" ? 0 : dist > 300 ? 1 : dist > 120 ? 2 : 3, taken = [];
            for (const it of list) { const isSel = it.id === sel.current; let show = isSel || it.L.tier <= maxTier;
              v.copy(it.L.pos).project(stage.camera); if (v.z > 1 || Math.abs(v.x) > 1.08 || Math.abs(v.y) > 1.08) show = false;
              if (show) { const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h, r = [sx - it.w / 2, sy - 20, sx + it.w / 2, sy + 4]; if (!isSel && taken.some((t) => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1])) show = false; else taken.push(r); }
              it.el.style.visibility = show ? "visible" : "hidden"; it.el.style.zIndex = isSel ? 9 : 4 - it.L.tier; } };
          stage.onAfterRender(() => { lab.render(stage.scene, stage.camera); if (frame++ % 3 === 0) declutter(); });
        }
        api.current = { stage, campus, view, THREE: stage.THREE };
        box.current.dataset.ready = "1";
      } catch (e) { console.error("3D map unavailable", e); if (alive) setFailed(true); }
    })();
    return () => { alive = false; off.forEach((f) => f()); ro?.disconnect(); campus?.dispose(); lab?.domElement.remove(); stage?.dispose(); api.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const a = api.current; if (!a) return; a.campus.setSelected(selectedId); if (selectedId) { const p = a.campus.anchors.get(selectedId); if (p) a.stage.flyTo(p.x, 0, p.z, 60, 1.0); } }, [selectedId, mounts]);

  const nudge = (o) => api.current?.stage.nudge(o);
  const reset = () => { const v = view; api.current?.stage.flyTo(v.x, 0, v.z, v.dist, v.pol); onSelect?.(null); };
  const onKey = (e) => { const k = e.key; if (k === "ArrowLeft") nudge({ az: -0.25 }); else if (k === "ArrowRight") nudge({ az: 0.25 }); else if (k === "ArrowUp") nudge({ pol: -0.12 }); else if (k === "ArrowDown") nudge({ pol: 0.12 }); else if (k === "+" || k === "=") nudge({ zoom: 0.85 }); else if (k === "-") nudge({ zoom: 1.18 }); else if (k === "Home") reset(); else return; e.preventDefault(); };

  return (
    <div ref={box} className={"stage " + className} style={style} tabIndex={interactive ? 0 : -1} role={interactive ? "group" : "img"} data-labels={labels ? "on" : "off"} onKeyDown={interactive ? onKey : undefined}
      aria-label={interactive ? "Interactive 3D map of the OAU campus. Drag to rotate, pinch or scroll to zoom. Arrow keys rotate, plus and minus zoom, Home resets. Every place is also listed under Places." : "A slowly turning 3D view of the OAU campus at dusk."}>
      <div data-canvas style={{ position: "absolute", inset: 0 }} />
      {failed && <p className="mut" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>The 3D map could not start on this device. You can still use Places to see everything.</p>}
      {interactive && !failed && (<>
        <div className="stage-ctrls">
          <button type="button" aria-label={labels ? "Hide building labels" : "Show building labels"} aria-pressed={labels} onClick={() => setLabels((v) => !v)}><Icon name={labels ? "eye" : "eyeOff"} /></button>
          <button type="button" aria-label="Rotate left" onClick={() => nudge({ az: -0.5 })}><Icon name="rotateLeft" /></button>
          <button type="button" aria-label="Rotate right" onClick={() => nudge({ az: 0.5 })}><Icon name="rotateRight" /></button>
          <button type="button" aria-label="Zoom in" onClick={() => nudge({ zoom: 0.8 })}><Icon name="plus" /></button>
          <button type="button" aria-label="Zoom out" onClick={() => nudge({ zoom: 1.25 })}><Icon name="minus" /></button>
          <button type="button" aria-label="Reset the view" onClick={reset}><Icon name="reset" /></button>
        </div>
        <p className="stage-credit">Map data © OpenStreetMap contributors</p>
      </>)}
      {mounts.map(({ id, el, L }) => createPortal(
        <button type="button" className="bl" data-kind={L.kind} data-tier={L.tier} data-approx={L.approx ? "true" : "false"} aria-pressed={selectedId === id} aria-label={L.name + (L.approx ? " (approximate position)" : "")} onClick={() => onSelect?.(id)}>
          <Icon name={ICON_OF[L.kind] ?? "town"} size={L.tier === 1 ? 16 : 13} /><span>{L.name}</span></button>, el, id))}
    </div>
  );
}