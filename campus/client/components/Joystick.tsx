"use client";

/**
 * Virtual joystick for touch screens (bottom-left, GTA-mobile style).
 * Drag anywhere inside the pad to walk in that direction (relative to the
 * camera), exactly like holding WASD.
 */
import { useRef, useState } from "react";
import type { CampusView } from "@campus/game/CampusView";

const RADIUS = 52; // px the knob can travel
const DEAD_ZONE = 0.28;

export default function Joystick({ view }: { view: CampusView }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (clientX: number, clientY: number) => {
    const rect = baseRef.current!.getBoundingClientRect();
    let x = clientX - (rect.left + rect.width / 2);
    let y = clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(x, y);
    if (len > RADIUS) {
      x = (x / len) * RADIUS;
      y = (y / len) * RADIUS;
    }
    setKnob({ x, y });
    const mag = Math.min(1, len / RADIUS);
    if (mag < DEAD_ZONE) return view.setStick(0, 0);
    // Any direction; the view makes it camera-relative and decides when to send.
    view.setStick(x / RADIUS, y / RADIUS);
  };

  const release = () => {
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    view.setStick(0, 0);
  };

  return (
    <div
      ref={baseRef}
      className="joystick"
      aria-label="Movement joystick"
      onPointerDown={(e) => {
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === pointer.current) update(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
