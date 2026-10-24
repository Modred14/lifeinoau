// components/TripHud.js
// What you see on top of the 3D map during a trip: the little map (tap it for the full route), where you are going and how far, the on-screen controls
// when you steer yourself, and a button to call the trip off. The travel engine (lib3d/travel.js) draws the maps into the canvases and reads `input`.
"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import SteeringWheel from "./SteeringWheel";
import { playSound } from "@/lib/sound";
import { fmtDuration } from "@/lib/travel.js";
import "./travel.css";

const TEXT = {
  intro: "Getting ready…", approach: "Walking to your ride", board: "Getting in…", ride: "On the way", paying: "Paying the fare…", alight: "Getting out…", exit: "Getting out…", afoot: "Out of the car", reenter: "Getting back in…", walk: "Walking to the door", door: "Going in…", enter: "Going in…", inside: "Going in…",
};

/** Stops the browser scrolling, zooming, selecting or opening a menu under a finger that is steering. */
const NO_GESTURE = { touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent" };

/** A thumb stick: drag inside the circle. Writes -1..1 into input.jx / input.jy. It follows ONE finger (the one that touched it first); other fingers, on it or elsewhere, are ignored. */
export function Stick({ input }) {
  const ref = useRef(null), id = useRef(null), [dot, setDot] = useState([0, 0]);
  const move = (e) => { const r = ref.current.getBoundingClientRect(), R = r.width / 2, dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R), d = Math.min(R * 0.8, Math.hypot(dx, dy)), a = Math.atan2(dy, dx), x = Math.cos(a) * d, y = Math.sin(a) * d; setDot([x, y]); input.jx = x / (R * 0.8); input.jy = -y / (R * 0.8); };
  const end = (e) => { if (e && e.pointerId !== id.current) return; id.current = null; setDot([0, 0]); input.jx = 0; input.jy = 0; };
  useEffect(() => () => { input.jx = 0; input.jy = 0; }, [input]); // leaving the screen never leaves the stick pushed
  return <div ref={ref} className="th-stick" style={NO_GESTURE} role="application" aria-label="Walk: drag to move" onContextMenu={(e) => e.preventDefault()}
    onPointerDown={(e) => { if (id.current != null) return; id.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); move(e); e.preventDefault(); }}
    onPointerMove={(e) => { if (e.pointerId === id.current) move(e); }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}><i style={{ transform: `translate(${dot[0]}px, ${dot[1]}px)` }} /></div>;
}
/** A button that is "down" while held, by the one finger that pressed it: a second finger on it does not press it again, and lifting that one does not release the first. */
export function Hold({ className, label, onDown, onUp, children }) {
  const id = useRef(null), up = (e) => { if (e.pointerId !== id.current) return; id.current = null; onUp(); };
  useEffect(() => () => { if (id.current != null) onUp(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <button type="button" className={className} style={NO_GESTURE} aria-label={label} data-sound="none" onPointerDown={(e) => { if (id.current != null) return; id.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); onDown(); e.preventDefault(); }} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onContextMenu={(e) => e.preventDefault()}>{children}</button>;
}

export default function TripHud({ trip, placeName, st, input, miniRef, previewRef, onCancel }) {
  const [preview, setPreview] = useState(false), phase = st?.phase ?? "intro", drive = trip.mode === "car" && !trip.driver, steering = phase === "drive", walking = ["trek", "approach", "walk", "afoot"].includes(phase);
  useEffect(() => { if (!preview) return; const k = (e) => e.key === "Escape" && setPreview(false); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [preview]);
  const m = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + " km" : n + " m");
  const vname = trip.mode === "bus" ? "bus" : trip.mode === "keke" ? "keke" : "car";
  const line = st?.settling ? "Confirming your fare…" : steering ? (st?.exiting ? "Stopping the car…" : `Drive to ${placeName}`) : phase === "afoot" ? `Walk to ${placeName}` : phase === "trek" ? `Walk to ${placeName}` : phase === "approach" ? `${st?.autoWalk ? "Walking" : "Walk"} to the ${vname}` : phase === "ride" ? `${vname[0].toUpperCase() + vname.slice(1)} to ${placeName}` : TEXT[phase] ?? "";
  // how long is left: the same arithmetic as the estimate on the travel sheet, from where everything is right now
  const eta = st?.eta != null && phase !== "inside" ? fmtDuration(st.eta) : "";
  return (
    <div className="th" data-phase={phase} style={{ WebkitTouchCallout: "none", userSelect: "none", WebkitUserSelect: "none" }}>
      <button type="button" className="th-cancel ghost" onClick={onCancel} data-sound="none"><Icon name="close" size={16} /> Cancel</button>
      <button type="button" className="th-mini" aria-label="Open the map to see your route" onClick={() => { setPreview(true); playSound("tap"); }}>
        <canvas ref={miniRef} width="320" height="320" />
        <span className="th-mini-hint">Tap for map</span>
      </button>
      <div className="th-chip" role="status">
        <b>{line}</b>
        <span className="num">{eta ? `${eta} left` : ""}{st && ["trek", "drive", "ride", "walk", "afoot"].includes(phase) ? ` · ${m(st.remain)}` : ""}{st && ["drive", "ride"].includes(phase) ? ` · ${st.speed} km/h` : ""}</span>
      </div>
      {walking && (<><Stick input={input} /><Hold className="th-btn th-run" label="Run" onDown={() => (input.run = true)} onUp={() => (input.run = false)}>RUN</Hold></>)}
      {steering && (
        <>
          <SteeringWheel input={input} />
          <button type="button" className="th-btn th-exit" aria-label="Exit car" data-sound="none" disabled={!!st?.exiting} onClick={() => { input.exit = true; playSound("tap"); }}>
            <Icon name="door" size={20} weight="bold" /> <span>{st?.exiting ? "Stopping…" : "Exit car"}</span>
          </button>
          <div className="th-pedals">
            <button type="button" className="th-btn th-horn" aria-label="Horn" data-sound="horn" onClick={() => playSound("tap")}><Icon name="horn" size={22} weight="fill" /></button>
            <Hold className="th-btn th-brake" label="Brake and reverse" onDown={() => (input.brake = 1)} onUp={() => (input.brake = 0)}><span>BRAKE</span><small>hold to reverse</small></Hold>
            <Hold className="th-btn th-gas" label="Accelerate" onDown={() => (input.gas = 1)} onUp={() => (input.gas = 0)}>GAS</Hold>
          </div>
        </>
      )}
      {phase === "afoot" && (st?.canEnter || st?.canClose) && (
        <div className="th-act">
          {st.canEnter && <button type="button" className="th-btn th-act-btn" data-sound="none" onClick={() => { input.enter = true; playSound("tap"); }}><Icon name="ride" size={20} weight="bold" /> Get in car</button>}
          {st.canClose && <button type="button" className="th-btn th-act-btn" data-sound="none" onClick={() => { input.close = true; playSound("tap"); }}><Icon name="door" size={20} weight="bold" /> Close door</button>}
        </div>
      )}
      {preview && (
        <div className="th-pre-scrim" onClick={() => setPreview(false)}>
          <div className="th-pre" role="dialog" aria-modal="true" aria-label="Route map" onClick={(e) => e.stopPropagation()}>
            <header><b>{placeName}</b><button type="button" className="ghost" aria-label="Close map" onClick={() => setPreview(false)}><Icon name="close" /></button></header>
            <canvas ref={previewRef} width="900" height="640" />
            <footer>
              <span className={"th-key " + ((st?.routeKind ?? (trip.mode === "trek" ? "walk" : "drive")) === "walk" ? "dots" : "solid")} aria-hidden="true" />
              {(st?.routeKind ?? (trip.mode === "trek" ? "walk" : "drive")) === "walk" ? "Walking route" : "Driving route"}{st ? ` · ${m(st.remain)} to go` : ""}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}