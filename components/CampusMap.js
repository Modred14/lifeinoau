// components/CampusMap.js
"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ICON_OF } from "../lib3d/landmarks.js";
import { loadCampusData, placeMeta } from "../lib3d/campusData.js";
import { Icon } from "./Icon";
import { playSound } from "@/lib/sound";
import { call } from "@/lib/client";
import { createTripSync } from "@/lib/tripSync";
import { useGame } from "@/lib/gameStore";
import { lookKey } from "@/lib/look.js";

const HOME_VIEW = { x: 0, z: 8, dist: 210, az: 0.7, pol: 0.95 };
const labelWidth = (name, tier) => Math.min(190, name.length * (tier === 1 ? 7.4 : 6.4) + 26);

/**
 * The 3D OAU campus, drawn from real footprints and roads (see lib3d/campusReal.js).
 * interactive=false gives a still backdrop (landing page); add zoomOnly to let people zoom it (wheel, pinch, + / - buttons) without rotating or
 * panning. autoRotate is off unless asked for. Every named building carries a label above its roof;
 * labels are real buttons. They thin out with distance and never overlap, and the "Labels" button hides them all.
 */
export default function CampusMap({ youId = null, trip = null, tripInput = null, getMini = null, getPreview = null, onTripState, onTripArrive, onTripEnter, onTripEnd, onTripNotice, interactive = true, zoomOnly = false, pins = true, autoRotate = false, selectedId = null, onSelect, billboards = null, className = "", style, view = HOME_VIEW }) {
  const box = useRef(null), api = useRef(null), noFly = useRef(false), sel = useRef(selectedId), cb = useRef(onSelect), [mounts, setMounts] = useState([]), [failed, setFailed] = useState(false), [labels, setLabels] = useState(true), [look, setLook] = useState(false), [hint, setHint] = useState(interactive);
  sel.current = selectedId; cb.current = onSelect;
  const tripCb = useRef({}); tripCb.current = { onTripState, onTripArrive, onTripEnter, onTripEnd, onTripNotice, getMini, getPreview, tripInput }; const tripRef = useRef(null);
  const canZoom = interactive || zoomOnly, hold = () => { noFly.current = true; setTimeout(() => { noFly.current = false; }, 400); }; // a tap on the map shouldn't re-centre it

  useEffect(() => {
    let alive = true, stage = null, campus = null, lab = null, ro = null, off = [];
    (async () => {
      try {
        const [{ createStage }, { buildRealCampus, addRealLighting }, { CSS2DRenderer, CSS2DObject }, data] = await Promise.all([import("../lib3d/stage.js"), import("../lib3d/campusReal.js"), import("three/addons/renderers/CSS2DRenderer.js"), loadCampusData()]);
        if (!alive) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches, host = box.current.querySelector("[data-canvas]");
        stage = createStage(host, { fov: 42, far: 1800, controls: { maxPolarAngle: 1.38, minPolarAngle: interactive ? 0.08 : 0.35, minDistance: interactive ? 6 : 50, maxDistance: interactive ? 520 : 360, enablePan: interactive, enableRotate: interactive, enableZoom: canZoom, autoRotate: autoRotate && !reduce, autoRotateSpeed: 0.45, screenSpacePanning: false, zoomToCursor: interactive } });
        const light = addRealLighting(stage.scene); campus = buildRealCampus(data, placeMeta(data)); stage.scene.add(campus.root);
        // the roads get their proper shape (lanes, pavements, markings) as soon as the road graph has loaded; the map is usable before then
        import("../lib3d/worldsvc.js").then((m) => m.loadServices(data)).then((svc) => { if (alive && campus) campus.setRoadGraph(svc.graph); }).catch((e) => console.warn("road graph unavailable, drawing the plain roads", e));
        stage.onFrame((t, dt) => { campus.update(t, dt); light.follow(stage.controls.target); });
        const { x, z, dist, az, pol } = view; stage.controls.target.set(x, 0, z); stage.camera.position.set(x + Math.sin(az) * Math.sin(pol) * dist, Math.cos(pol) * dist, z + Math.cos(az) * Math.sin(pol) * dist); stage.controls.update();
        if (interactive) { // drag = slide the map under your hand (like any map app); right-drag or two fingers twisting still turn it. The map can't be dragged off the campus.
          const T = stage.THREE, c = stage.controls, cam = stage.camera, bd = campus.bounds, pad = 40;
          c.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE }; c.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
          const keep = () => { const x = Math.min(bd.x1 + pad, Math.max(bd.x0 - pad, c.target.x)), z = Math.min(bd.z1 + pad, Math.max(bd.z0 - pad, c.target.z)), dx = x - c.target.x, dz = z - c.target.z; if (dx || dz) { c.target.x += dx; c.target.z += dz; cam.position.x += dx; cam.position.z += dz; } };
          c.addEventListener("change", keep); off.push(() => c.removeEventListener("change", keep)); }
        if (!canZoom) stage.renderer.domElement.style.pointerEvents = "none";
        // click a named building to inspect it (a drag is not a click)
        if (interactive) { const el = stage.renderer.domElement, ray = new stage.THREE.Raycaster(), ndc = new stage.THREE.Vector2(); let d0 = null;
          const down = (e) => { d0 = [e.clientX, e.clientY, performance.now()]; };
          const up = (e) => { if (box.current?.dataset.trip) return; if (!d0 || Math.hypot(e.clientX - d0[0], e.clientY - d0[1]) > 5 || performance.now() - d0[2] > 500) return; const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, stage.camera); const id = campus.pick(ray); if (id) { hold(); playSound("tap"); cb.current?.(id); } };
          const plane = new stage.THREE.Plane(new stage.THREE.Vector3(0, 1, 0), 0), at = new stage.THREE.Vector3();
          const zoomIn = (e) => { if (box.current?.dataset.trip) return; /* on a trip the trip camera is in charge: a double tap must not send the map camera flying */ const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, stage.camera); if (!ray.ray.intersectPlane(plane, at)) return; const d = stage.camera.position.distanceTo(stage.controls.target); stage.flyTo(at.x, 0, at.z, Math.max(stage.controls.minDistance + 10, d * 0.45), null); }; // double-click or double-tap: glide in on that spot
          el.addEventListener("pointerdown", down); el.addEventListener("pointerup", up); el.addEventListener("dblclick", zoomIn); off.push(() => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointerup", up); el.removeEventListener("dblclick", zoomIn); }); }
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
        api.current = { stage, campus, view, light, data, THREE: stage.THREE };
        box.current.dataset.ready = "1";
      } catch (e) { console.error("3D map unavailable", e); if (alive) setFailed(true); }
    })();
    return () => { alive = false; off.forEach((f) => f()); ro?.disconnect(); campus?.dispose(); lab?.domElement.remove(); stage?.dispose(); api.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const a = api.current; if (!a) return; a.campus.setSelected(selectedId); if (selectedId && !noFly.current) { const p = a.campus.resolve(selectedId)?.pos; if (p) a.stage.flyTo(p.x, 0, p.z, 60, 1.0); } noFly.current = false; }, [selectedId, mounts]);

  useEffect(() => { const a = api.current; if (a) a.campus.setYou(youId); }, [youId, mounts]);
  // the player changed their look in Settings while on a trip: the character on the road changes with it
  const me = useGame()?.character, meKey = me ? lookKey(me.look, me.gender) : "";
  useEffect(() => { if (me) tripRef.current?.setLook?.(me.look, me.gender); }, [meKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- a trip: the travel engine takes over the camera until it ends ----
  useEffect(() => {
    const a = api.current; if (!trip || !a) return; let dead = false, handle = null, sync = null, unhook = null;
    const end = (why) => { if (dead) return; tripCb.current.onTripEnd?.(why); };
    (async () => {
      try {
        const { startTrip } = await import("../lib3d/travel.js"); if (dead) return;
        box.current.dataset.trip = "1";
        handle = await startTrip({ stage: a.stage, campus: a.campus, light: a.light, data: a.data }, { ...trip, input: tripCb.current.tripInput ?? {}, miniCanvas: () => tripCb.current.getMini?.() ?? null, previewCanvas: () => tripCb.current.getPreview?.() ?? null,
          onState: (st) => tripCb.current.onTripState?.(st), onNotice: (m) => tripCb.current.onTripNotice?.(m), onArrive: () => tripCb.current.onTripArrive?.() ?? true, onEnter: () => tripCb.current.onTripEnter?.(), onEnd: end });
        if (dead) { handle?.dispose(); return; } tripRef.current = handle;
        if (!handle) return end("error");
        // real players on the road, in the BACKGROUND: where we are goes to the server and who else is out there comes back without ever touching how the player moves (that is local and
        // immediate). lib/tripSync.js sends the latest pose only, never two requests at once, backs off when the connection is slow or down, and sends at once when it comes back.
        const quick = { timeout: 6000, retries: 0 };
        sync = createTripSync({
          getPose: () => { const p = handle.pos(); return { x: p.x, z: p.z, h: p.h, mode: trip.mode }; },
          send: (p, { signal }) => call("/api/travel", { action: "trip", x: p.x, z: p.z, h: p.h, mode: p.mode }, { ...quick, signal }),
          fetchRoad: ({ signal }) => call("/api/travel?road=1", undefined, { ...quick, signal }),
          onTravellers: (list) => { if (!dead) handle?.setTravellers(list); },
          isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false, isHidden: () => typeof document !== "undefined" && document.hidden,
        });
        const wake = () => sync?.nudge(), leave = () => { try { fetch("/api/travel", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "trip" }) }); } catch { /* the server drops a silent traveller after a few seconds anyway */ } };
        addEventListener("online", wake); document.addEventListener("visibilitychange", wake); addEventListener("pagehide", leave);
        unhook = () => { removeEventListener("online", wake); document.removeEventListener("visibilitychange", wake); removeEventListener("pagehide", leave); };
        sync.start();
      } catch (e) { if (e?.reason && e.reason !== "error") { tripCb.current.onTripNotice?.(e.text ?? e.message); end(e.reason); } else { console.error("trip failed", e); end("error"); } }
    })();
    return () => { dead = true; sync?.stop(); unhook?.(); handle?.dispose(); tripRef.current = null; if (box.current) delete box.current.dataset.trip; call("/api/travel", { action: "trip" }); const b = api.current; if (b) { const L = b.campus.resolve(trip.to); if (L) b.stage.flyTo(L.x, 0, L.z, 70, 1.0); } };
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const a = api.current; if (a && billboards) a.campus.setBillboards(billboards); }, [billboards, mounts]);

  // "Look around" turns one-finger / left-button drag into orbit + tilt (to inspect a building in 3D); off, it slides the map. Two fingers or right-drag always turn and tilt.
  useEffect(() => { const c = api.current?.stage.controls; if (!c || !interactive) return; const T = api.current.THREE; c.mouseButtons = { LEFT: look ? T.MOUSE.ROTATE : T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: look ? T.MOUSE.PAN : T.MOUSE.ROTATE }; c.touches = { ONE: look ? T.TOUCH.ROTATE : T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE }; }, [look, mounts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!hint) return; const t = setTimeout(() => setHint(false), 7000); return () => clearTimeout(t); }, [hint]);
  const nudge = (o) => api.current?.stage.nudge(o);
  const reset = () => { const v = view; api.current?.stage.flyTo(v.x, 0, v.z, v.dist, v.pol); onSelect?.(null); };
  const onKey = (e) => { const k = e.key; if (k === "ArrowLeft") nudge(e.shiftKey ? { az: -0.25 } : { panX: -0.12 }); else if (k === "ArrowRight") nudge(e.shiftKey ? { az: 0.25 } : { panX: 0.12 }); else if (k === "ArrowUp") nudge(e.shiftKey ? { pol: -0.12 } : { panZ: 0.12 }); else if (k === "ArrowDown") nudge(e.shiftKey ? { pol: 0.12 } : { panZ: -0.12 }); else if (k === "+" || k === "=") nudge({ zoom: 0.85 }); else if (k === "-") nudge({ zoom: 1.18 }); else if (k === "Home") reset(); else return; e.preventDefault(); };

  return (
    <div ref={box} className={"stage " + className} style={style} tabIndex={interactive ? 0 : -1} role={interactive ? "group" : "img"} data-labels={labels ? "on" : "off"} onKeyDown={interactive ? onKey : undefined}
      aria-label={interactive ? "Interactive 3D map of the OAU campus. Drag to slide the map, pinch or scroll to zoom, right-drag to turn it. Arrow keys slide the map, shift and arrow keys turn it, plus and minus zoom, Home resets. Every place is also listed under Places." : zoomOnly ? "A 3D view of the OAU campus. Scroll, pinch or use the zoom buttons to zoom in and out." : "A 3D view of the OAU campus."}>
      <div data-canvas style={{ position: "absolute", inset: 0 }} />
      {failed && <p className="mut" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>The 3D map could not start on this device. You can still use Places to see everything.</p>}
      {zoomOnly && !interactive && !failed && (
        <div className="stage-ctrls stage-ctrls--zoom">
          <button type="button" aria-label="Zoom in" onClick={() => nudge({ zoom: 0.8 })}><Icon name="plus" /></button>
          <button type="button" aria-label="Zoom out" onClick={() => nudge({ zoom: 1.25 })}><Icon name="minus" /></button>
        </div>)}
      {interactive && !failed && (<>
        <div className="stage-ctrls stage-ctrls--map">
          <button type="button" aria-label={look ? "Look around is on: drag to orbit and tilt. Tap to go back to moving the map" : "Look around: drag to orbit and tilt, to see a building in 3D"} title="Look around in 3D" aria-pressed={look} className={look ? "on" : ""} onClick={() => { setLook((v) => !v); setHint(false); }}><Icon name={look ? "cube" : "move"} /></button>
          <button type="button" aria-label="Tilt up, towards a top-down view" onClick={() => nudge({ pol: -0.16 })}><Icon name="up" /></button>
          <button type="button" aria-label="Tilt down, towards a street-level view" onClick={() => nudge({ pol: 0.16 })}><Icon name="down" /></button>
          <button type="button" aria-label={labels ? "Hide building labels" : "Show building labels"} aria-pressed={labels} onClick={() => setLabels((v) => !v)}><Icon name={labels ? "eye" : "eyeOff"} /></button>
          <button type="button" aria-label="Rotate left" onClick={() => nudge({ az: -0.5 })}><Icon name="rotateLeft" /></button>
          <button type="button" aria-label="Rotate right" onClick={() => nudge({ az: 0.5 })}><Icon name="rotateRight" /></button>
          <button type="button" aria-label="Zoom in" onClick={() => nudge({ zoom: 0.8 })}><Icon name="plus" /></button>
          <button type="button" aria-label="Zoom out" onClick={() => nudge({ zoom: 1.25 })}><Icon name="minus" /></button>
          <button type="button" aria-label="Reset the view" onClick={reset}><Icon name="reset" /></button>
        </div>
        {hint && <p className="stage-hint" role="status" onClick={() => setHint(false)}>Drag to move · pinch to zoom · two fingers to turn and tilt · double-tap to zoom in</p>}
        {/* <p className="stage-credit">Map data © OpenStreetMap contributors</p> */}
      </>)}
      {mounts.map(({ id, el, L }) => createPortal(
        <button type="button" className="bl" data-kind={L.kind} data-tier={L.tier} data-approx={L.approx ? "true" : "false"} aria-pressed={selectedId === id} aria-label={L.name + (L.approx ? " (approximate position)" : "")} onClick={() => { hold(); onSelect?.(id); }}>
          <Icon name={ICON_OF[L.kind] ?? "town"} size={L.tier === 1 ? 16 : 13} /><span>{L.name}</span></button>, el, id))}
    </div>
  );
}