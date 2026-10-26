// components/SteeringWheel.js
// The on-screen steering wheel: put a finger (or the mouse) on the rim and turn it like a real wheel. Clockwise steers right, anticlockwise left; let go and it spins back to straight.
//
// It writes one number, -1..1, into input.steer (the trip reads it every frame; lib3d/carphysics.js turns it into front-wheel angle with its own rate limit and speed-dependent lock, so
// the car never snaps). Rules that keep it from fighting everything else on the screen:
//   - it follows ONE finger (the one that touched it first); other fingers on it are ignored, and other fingers elsewhere (camera, pedals) never move it,
//   - the pointer is captured, so a thumb sliding off the rim keeps turning it and never scrolls or swipes the page, the Phone or the bottom bar,
//   - the turn is tracked as an accumulated angle (never the raw angle), so crossing the top of the wheel cannot flip the steering from full right to full left,
//   - it is drawn by writing a transform straight to the element each frame, so turning it never re-renders React,
//   - it shows it has a finger on it (data-held), and the touch area is the whole round pad (components/travel.css sizes it for each screen: bigger on a tablet, smaller on a phone held sideways).
// (The keyboard steers through lib3d/tripkeys.js and lib3d/keysteer.js; the two add up in lib3d/travel.js.)
"use client";
import { useEffect, useRef } from "react";
import { WHEEL_LOCK, steerFromAngle, wrapAngle } from "@/lib3d/wheelmath.js";

const NO_GESTURE = { touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent" };

export default function SteeringWheel({ input }) {
  const root = useRef(null), rim = useRef(null), st = useRef({ id: null, last: 0, angle: 0, held: false, raf: 0, t: 0 }).current;

  const paint = () => { if (rim.current) rim.current.style.transform = `rotate(${st.angle}rad)`; input.steer = steerFromAngle(st.angle); root.current?.setAttribute("aria-valuenow", input.steer.toFixed(2)); };
  const tick = (now) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - (st.t || now)) / 1000)); st.t = now;
    if (!st.held && st.angle !== 0) { st.angle *= Math.exp(-dt * 9); if (Math.abs(st.angle) < 0.003) st.angle = 0; paint(); }
    st.raf = st.angle !== 0 || st.held ? requestAnimationFrame(tick) : 0;
  };
  const wake = () => { if (!st.raf) { st.t = 0; st.raf = requestAnimationFrame(tick); } };
  const angleOf = (e) => { const r = root.current.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
  const release = (e) => { if (e && e.pointerId !== st.id) return; st.id = null; st.held = false; delete root.current?.dataset.held; wake(); };

  useEffect(() => () => { cancelAnimationFrame(st.raf); st.raf = 0; st.id = null; st.held = false; st.angle = 0; input.steer = 0; }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={root} className="th-wheel" style={NO_GESTURE} role="slider" aria-label="Steering wheel: turn it to steer" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={0} data-sound="none"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => { if (st.id != null) return; st.id = e.pointerId; st.held = true; if (root.current) root.current.dataset.held = "1"; st.last = angleOf(e); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer may be gone */ } wake(); e.preventDefault(); }}
      onPointerMove={(e) => {
        if (e.pointerId !== st.id) return; const a = angleOf(e), d = wrapAngle(a - st.last); st.last = a;
        st.angle = Math.max(-WHEEL_LOCK * 1.08, Math.min(WHEEL_LOCK * 1.08, st.angle + d)); paint(); e.preventDefault();
      }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      <svg ref={rim} viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
        <circle r="44" fill="none" stroke="rgba(255,255,255,0.94)" strokeWidth="9" />
        <circle r="39.2" fill="none" stroke="rgba(13,19,33,0.35)" strokeWidth="1.2" />
        <path d="M-40 6 L-13 6 L-7 18 L7 18 L13 6 L40 6" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
        <circle r="11" fill="rgba(255,255,255,0.95)" /><circle r="4.5" fill="rgba(13,19,33,0.7)" />
        <path d="M-5 -49 L0 -41 L5 -49 Z" fill="#ffd24a" />
      </svg>
    </div>
  );
}
