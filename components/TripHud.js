// components/TripHud.js
// What you see on top of the 3D map during a trip: the little map (tap it for the full route), where you are going and how far, the on-screen controls
// when you steer yourself, and a button to call the trip off. The travel engine (lib3d/travel.js) draws the maps into the canvases and reads `input`.
"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { playSound } from "@/lib/sound";
import "./travel.css";

const TEXT = {
  intro: "Getting ready…", board: "Getting in…", ride: "On the way", paying: "Paying the fare…", alight: "Getting out…", door: "Going in…", enter: "Going in…", inside: "Going in…",
};

/** A thumb stick: drag inside the circle. Writes -1..1 into input.jx / input.jy. */
export function Stick({ input }) {
  const ref = useRef(null), [dot, setDot] = useState([0, 0]);
  const move = (e) => { const r = ref.current.getBoundingClientRect(), R = r.width / 2, dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R), d = Math.min(R * 0.8, Math.hypot(dx, dy)), a = Math.atan2(dy, dx), x = Math.cos(a) * d, y = Math.sin(a) * d; setDot([x, y]); input.jx = x / (R * 0.8); input.jy = -y / (R * 0.8); };
  const end = () => { setDot([0, 0]); input.jx = 0; input.jy = 0; };
  return <div ref={ref} className="th-stick" role="application" aria-label="Walk: drag to move" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }} onPointerMove={(e) => e.buttons && move(e)} onPointerUp={end} onPointerCancel={end}><i style={{ transform: `translate(${dot[0]}px, ${dot[1]}px)` }} /></div>;
}
/** A button that is "down" while held. */
export function Hold({ className, label, onDown, onUp, children }) {
  return <button type="button" className={className} aria-label={label} data-sound="none" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onDown(); }} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp} onContextMenu={(e) => e.preventDefault()}>{children}</button>;
}

export default function TripHud({ trip, placeName, st, input, miniRef, previewRef, onCancel }) {
  const [preview, setPreview] = useState(false), phase = st?.phase ?? "intro", drive = trip.mode === "car" && !trip.driver, steering = phase === "drive", walking = phase === "trek";
  useEffect(() => { if (!preview) return; const k = (e) => e.key === "Escape" && setPreview(false); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [preview]);
  const m = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + " km" : n + " m");
  const line = steering ? `Drive to ${placeName}` : walking ? `Walk to ${placeName}` : phase === "ride" ? `${trip.mode === "bus" ? "Bus" : trip.mode === "keke" ? "Keke" : "Car"} to ${placeName}` : TEXT[phase] ?? "";
  return (
    <div className="th" data-phase={phase}>
      <button type="button" className="th-cancel ghost" onClick={onCancel} data-sound="none"><Icon name="close" size={16} /> Cancel</button>
      <button type="button" className="th-mini" aria-label="Open the map to see your route" onClick={() => { setPreview(true); playSound("tap"); }}>
        <canvas ref={miniRef} width="320" height="320" />
        <span className="th-mini-hint">Tap for map</span>
      </button>
      <div className="th-chip" role="status">
        <b>{line}</b>
        <span className="num">{st?.left != null ? `${Math.ceil(st.left)}s` : st && ["trek", "drive", "ride"].includes(phase) ? m(st.remain) : ""}{st && phase === "drive" ? ` · ${st.speed} km/h` : ""}</span>
      </div>
      {walking && (<><Stick input={input} /><Hold className="th-btn th-run" label="Run" onDown={() => (input.run = true)} onUp={() => (input.run = false)}>RUN</Hold></>)}
      {steering && (
        <>
          <div className="th-steer">
            <Hold className="th-btn" label="Steer left" onDown={() => (input.steer = -1)} onUp={() => (input.steer = 0)}><Icon name="left" size={30} weight="bold" /></Hold>
            <Hold className="th-btn" label="Steer right" onDown={() => (input.steer = 1)} onUp={() => (input.steer = 0)}><Icon name="right" size={30} weight="bold" /></Hold>
          </div>
          <div className="th-pedals">
            <button type="button" className="th-btn th-horn" aria-label="Horn" data-sound="horn" onClick={() => playSound("tap")}><Icon name="horn" size={22} weight="fill" /></button>
            <Hold className="th-btn th-brake" label="Brake" onDown={() => (input.brake = 1)} onUp={() => (input.brake = 0)}>BRAKE</Hold>
            <Hold className="th-btn th-gas" label="Accelerate" onDown={() => (input.gas = 1)} onUp={() => (input.gas = 0)}>GAS</Hold>
          </div>
        </>
      )}
      {preview && (
        <div className="th-pre-scrim" onClick={() => setPreview(false)}>
          <div className="th-pre" role="dialog" aria-modal="true" aria-label="Route map" onClick={(e) => e.stopPropagation()}>
            <header><b>{placeName}</b><button type="button" className="ghost" aria-label="Close map" onClick={() => setPreview(false)}><Icon name="close" /></button></header>
            <canvas ref={previewRef} width="900" height="640" />
            <footer>
              <span className={"th-key " + (trip.mode === "trek" ? "dots" : "solid")} aria-hidden="true" />
              {trip.mode === "trek" ? "Walking route" : "Driving route"}{st ? ` · ${m(st.remain)} to go` : ""}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}