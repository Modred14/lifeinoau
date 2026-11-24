// components/SteerButtons.js
// The on-screen steering for a drive on the map: two buttons, left and right (the same pad the home compound uses), instead of a wheel to turn.
// Hold one to steer that way, let go and the wheel goes back to straight. Holding both cancels out.
//
// It writes one number, -1..1 (+1 = right), into input.steer, the same as the old wheel did, so lib3d/travel.js and lib3d/carphysics.js read it unchanged. The number is moved towards
// full lock at a limited rate (lib3d/keysteer.js, the same maths as the A / D keys), so a tap is a small correction and holding is a full turn: the car never snaps sideways.
// Rules: each button is a hold (lib/pointerHold.js: ONE finger per button, the pointer is captured so a thumb sliding off a button keeps steering until it lifts and never scrolls the page,
// and the page letting go on blur / hidden tab straightens the wheel at once); nothing re-renders React while steering (the press state is written straight to the element);
// leaving the screen never leaves the wheel turned.
"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { NO_GESTURE, useHold } from "./HoldButton";
import { stepKeySteer } from "@/lib3d/keysteer.js";

export default function SteerButtons({ input }) {
  const s = useRef({ left: false, right: false, raf: 0, t: 0 }).current, L = useRef(null), R = useRef(null);
  const dir = () => (s.right ? 1 : 0) - (s.left ? 1 : 0);
  const tick = (now) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - (s.t || now)) / 1000)); s.t = now;
    input.steer = stepKeySteer(input.steer ?? 0, dir(), dt);
    if (Math.abs(input.steer) < 0.001 && dir() === 0) { input.steer = 0; s.raf = 0; return; }
    s.raf = requestAnimationFrame(tick);
  };
  const wake = () => { if (!s.raf) { s.t = 0; s.raf = requestAnimationFrame(tick); } };
  const side = (k) => (on, forced) => { s[k] = on; if (!on && forced) input.steer = dir() === 0 ? 0 : input.steer; wake(); };   // a forced release (blur, hidden tab) straightens at once: no frame may come to ease it
  const hl = useHold(L, () => side("left")(true), (f) => side("left")(false, f)), hr = useHold(R, () => side("right")(true), (f) => side("right")(false, f));
  useEffect(() => () => { cancelAnimationFrame(s.raf); s.raf = 0; s.left = s.right = false; input.steer = 0; }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="th-steer" role="group" aria-label="Steering: hold left or right" data-sound="none">
      <button type="button" ref={L} className="th-btn th-sb" style={NO_GESTURE} aria-label="Steer left" data-sound="none" {...hl.handlers}><Icon name="left" size={30} weight="bold" /></button>
      <button type="button" ref={R} className="th-btn th-sb" style={NO_GESTURE} aria-label="Steer right" data-sound="none" {...hr.handlers}><Icon name="right" size={30} weight="bold" /></button>
    </div>
  );
}
