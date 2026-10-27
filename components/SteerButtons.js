// components/SteerButtons.js
// The on-screen steering for a drive on the map: two buttons, left and right (the same pad the home compound uses), instead of a wheel to turn.
// Hold one to steer that way, let go and the wheel goes back to straight. Holding both cancels out.
//
// It writes one number, -1..1 (+1 = right), into input.steer, the same as the old wheel did, so lib3d/travel.js and lib3d/carphysics.js read it unchanged. The number is moved towards
// full lock at a limited rate (lib3d/keysteer.js, the same maths as the A / D keys), so a tap is a small correction and holding is a full turn: the car never snaps sideways.
// Rules: each button follows ONE finger; the pointer is captured, so a thumb sliding off a button keeps steering until it lifts and never scrolls the page; nothing re-renders React while
// steering (the press state is written straight to the element); leaving the screen never leaves the wheel turned.
"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { stepKeySteer } from "@/lib3d/keysteer.js";

const NO_GESTURE = { touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent" };

export default function SteerButtons({ input }) {
  const s = useRef({ left: null, right: null, raf: 0, t: 0 }).current, els = useRef({});
  const dir = () => (s.right != null ? 1 : 0) - (s.left != null ? 1 : 0);
  const tick = (now) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - (s.t || now)) / 1000)); s.t = now;
    input.steer = stepKeySteer(input.steer ?? 0, dir(), dt);
    if (Math.abs(input.steer) < 0.001 && dir() === 0) { input.steer = 0; s.raf = 0; return; }
    s.raf = requestAnimationFrame(tick);
  };
  const wake = () => { if (!s.raf) { s.t = 0; s.raf = requestAnimationFrame(tick); } };
  const mark = (side, on) => { const b = els.current[side]; if (!b) return; if (on) b.dataset.down = "1"; else delete b.dataset.down; };
  useEffect(() => () => { cancelAnimationFrame(s.raf); s.raf = 0; s.left = s.right = null; input.steer = 0; }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (side) => ({
    onPointerDown: (e) => { if (s[side] != null) return; s[side] = e.pointerId; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer may be gone */ } mark(side, true); wake(); e.preventDefault(); },
    onPointerUp: (e) => { if (e.pointerId !== s[side]) return; s[side] = null; mark(side, false); wake(); },
    onPointerCancel: (e) => { if (e.pointerId !== s[side]) return; s[side] = null; mark(side, false); wake(); },
    onLostPointerCapture: (e) => { if (e.pointerId !== s[side]) return; s[side] = null; mark(side, false); wake(); },
    onContextMenu: (e) => e.preventDefault(),
  });
  return (
    <div className="th-steer" role="group" aria-label="Steering: hold left or right" data-sound="none">
      <button type="button" ref={(el) => (els.current.left = el)} className="th-btn th-sb" style={NO_GESTURE} aria-label="Steer left" data-sound="none" {...press("left")}><Icon name="left" size={30} weight="bold" /></button>
      <button type="button" ref={(el) => (els.current.right = el)} className="th-btn th-sb" style={NO_GESTURE} aria-label="Steer right" data-sound="none" {...press("right")}><Icon name="right" size={30} weight="bold" /></button>
    </div>
  );
}
