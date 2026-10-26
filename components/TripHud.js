// components/TripHud.js
// What you see on top of the 3D map during a trip: the little map (tap it for the full route), where you are going and how far, the on-screen controls
// when you steer yourself, and a button to call the trip off. The travel engine (lib3d/travel.js) draws the maps into the canvases and reads `input`.
//
// Where things sit (components/travel.css has the sizes for each screen): the mini map and the speed readout are in the TOP RIGHT; the panel that says where you are going (with Cancel)
// is in the TOP LEFT; the steering wheel (or the walking stick) is in the bottom left corner and the pedals in the bottom right. The middle of the screen, where the road ahead and the
// vehicle are, is left empty on every screen size.
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
/** A button that is "down" while held, by the one finger that pressed it: a second finger on it does not press it again, and lifting that one does not release the first. While it is down it
 *  carries data-down, so the button can show it (written straight to the element: pressing a pedal never re-renders the screen). */
export function Hold({ className, label, onDown, onUp, children }) {
  const id = useRef(null), el = useRef(null), mark = (on) => { const b = el.current; if (!b) return; if (on) b.dataset.down = "1"; else delete b.dataset.down; };
  const up = (e) => { if (e.pointerId !== id.current) return; id.current = null; mark(false); onUp(); };
  useEffect(() => () => { if (id.current != null) onUp(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <button ref={el} type="button" className={className} style={NO_GESTURE} aria-label={label} data-sound="none" onPointerDown={(e) => { if (id.current != null) return; id.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); mark(true); onDown(); e.preventDefault(); }} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onContextMenu={(e) => e.preventDefault()}>{children}</button>;
}

export default function TripHud({ trip, placeName, st, input, miniRef, previewRef, onCancel }) {
  const [preview, setPreview] = useState(false), phase = st?.phase ?? "intro", drive = trip.mode === "car" && !trip.driver, steering = phase === "drive", walking = ["trek", "approach", "walk", "afoot", "door"].includes(phase), doorOn = phase === "door" && st?.hasDoor;
  // the H key is the horn on a keyboard (never while typing, never with a shortcut such as Ctrl+H, and not on key repeat: one press, one honk)
  useEffect(() => { if (!steering) return; const k = (e) => { if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target?.closest?.("input,textarea,select")) return; if (e.code === "KeyH" || (!e.code && e.key?.toLowerCase() === "h")) playSound("horn"); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [steering]);
  useEffect(() => { if (!preview) return; const k = (e) => e.key === "Escape" && setPreview(false); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [preview]);
  const m = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + " km" : n + " m");
  const vname = trip.mode === "bus" ? "bus" : trip.mode === "keke" ? "keke" : "car";
  const doorLine = !doorOn ? "" : st.door === "closed" ? (st.canOpen ? "At the door" : "Walk up to the door") : st.door === "back" ? "Stepping back…" : st.door === "opening" ? "Opening the door…" : st.door === "closing" ? "Closing the door…" : "Door open: go in";
  const line = doorLine ? `${doorLine}${placeName ? " · " + placeName : ""}` : st?.settling ? "Confirming your fare…" : steering ? (st?.exiting ? "Stopping the car…" : st?.free ? "Driving on the main road · tap a place name to go there" : `Drive to ${placeName}`) : phase === "afoot" ? `Walk to ${placeName}` : phase === "trek" ? `Walk to ${placeName}` : phase === "approach" ? `${st?.autoWalk ? "Walking" : "Walk"} to the ${vname}` : phase === "ride" ? `${vname[0].toUpperCase() + vname.slice(1)} to ${placeName}` : TEXT[phase] ?? "";
  // how long is left: the same arithmetic as the estimate on the travel sheet, from where everything is right now
  const eta = st?.eta != null && phase !== "inside" && phase !== "door" ? fmtDuration(st.eta) : "";
  const showSpeed = st && ["drive", "ride"].includes(phase), gear = st?.gear || "D", stopped = (st?.speed ?? 0) < 1;
  // the line under the title: time left and distance; near the end of a drive it says where to stop instead
  const sub = st?.free ? "" : steering && st && st.remain <= 45 ? `Pull over at the green bay · ${m(st.remain)}` : [eta ? `${eta} left` : "", st && ["trek", "drive", "ride", "walk", "afoot"].includes(phase) ? m(st.remain) : ""].filter(Boolean).join(" · ");
  return (
    <div className="th" data-phase={phase} style={{ WebkitTouchCallout: "none", userSelect: "none", WebkitUserSelect: "none" }}>
      <div className="th-info">
        <button type="button" className="th-cancel ghost" aria-label="Cancel the trip" onClick={onCancel} data-sound="none"><Icon name="close" size={16} /> <span>Cancel</span></button>
        <div className="th-card" role="status">
          {steering && st?.turn != null && <i className="th-dir" aria-hidden="true" style={{ transform: `rotate(${Math.round((st.turn * 180) / Math.PI) + 180}deg)` }}><Icon name="arrowDown" size={20} weight="bold" /></i>}
          <div className="th-card-t"><b>{line}</b>{sub && <span className="num">{sub}</span>}</div>
        </div>
      </div>
      <div className="th-side">
        <button type="button" className="th-mini" aria-label="Open the map to see your route" onClick={() => { setPreview(true); playSound("tap"); }}>
          <canvas ref={miniRef} width="320" height="320" />
          <span className="th-mini-hint">Tap for map</span>
        </button>
        {showSpeed && <div className="th-speed" aria-label={`${st.speed} kilometres per hour${steering ? ", gear " + (gear === "R" ? "reverse" : "drive") : ""}`}><b className="num">{st.speed}</b><small>km/h</small>{steering && <em data-gear={gear} aria-hidden="true">{gear}</em>}</div>}
      </div>
      {st?.auto && (<button type="button" className="th-btn th-stop" data-sound="none" onClick={() => { input.stop = true; playSound("tap"); }}><Icon name="close" size={18} weight="bold" /> Stop walking</button>)}
      {doorOn && st.door === "closed" && st.canOpen && (<button type="button" className="th-btn th-act-btn th-opendoor" data-sound="none" onClick={() => { input.door = true; playSound("tap"); }}><Icon name="door" size={20} weight="bold" /> Open Door</button>)}
      {doorOn && st.door === "open" && st.canGoIn && (<button type="button" className="th-btn th-act-btn th-opendoor" data-sound="none" onClick={() => { input.goin = true; playSound("tap"); }}><Icon name="door" size={20} weight="bold" /> Go in</button>)}
      {walking && (<><Stick input={input} /><Hold className="th-btn th-run" label="Run" onDown={() => (input.run = true)} onUp={() => (input.run = false)}>RUN</Hold></>)}
      {steering && (
        <>
          <SteeringWheel input={input} />
          <div className="th-pedals">
            <div className="th-aux">
              <button type="button" className="th-btn th-horn" aria-label="Horn" data-sound="none" style={NO_GESTURE} onPointerDown={() => playSound("horn")} onClick={(e) => { if (e.detail === 0) playSound("horn"); /* Enter or Space on the focused button: a pointer press has already honked */ }} onContextMenu={(e) => e.preventDefault()}><Icon name="horn" size={22} weight="fill" /></button>
              <button type="button" className="th-btn th-exit" aria-label="Exit car" data-sound="none" disabled={!!st?.exiting} onClick={() => { input.exit = true; playSound("tap"); }}>
                <Icon name="door" size={20} weight="bold" /> <span>{st?.exiting ? "Stopping…" : "Exit car"}</span>
              </button>
            </div>
            <Hold className="th-btn th-pedal th-brake" label={gear === "R" ? "Reverse" : "Brake, hold to reverse"} onDown={() => (input.brake = 1)} onUp={() => (input.brake = 0)}>
              <span className="th-grip" aria-hidden="true"><i /><i /><i /></span>
              <b>{gear === "R" ? "REVERSE" : "BRAKE"}</b>{gear !== "R" && stopped && <small>hold to reverse</small>}
            </Hold>
            <Hold className="th-btn th-pedal th-gas" label="Accelerate" onDown={() => (input.gas = 1)} onUp={() => (input.gas = 0)}>
              <span className="th-grip" aria-hidden="true"><i /><i /><i /></span>
              <b>GAS</b>
            </Hold>
          </div>
          <div className="th-keys" aria-hidden="true"><span><kbd>W</kbd><kbd>↑</kbd> Gas</span><span><kbd>S</kbd><kbd>↓</kbd> Brake · hold to reverse</span><span><kbd>A</kbd><kbd>D</kbd> Steer</span><span><kbd>H</kbd> Horn</span><span><kbd>E</kbd> Exit car</span></div>
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
              {(st?.routeKind ?? (trip.mode === "trek" ? "walk" : "drive")) === "walk" ? "Walking route" : "Driving route"}{st && !st.free ? ` · ${m(st.remain)} to go` : ""}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}