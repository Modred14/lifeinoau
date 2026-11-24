// components/HoldButton.js
// A button that is "down" while it is held: the pedals, the horn, climb and descend, the garage and compound pads. All the press / release rules live in lib/pointerHold.js (one finger per
// control, right mouse button ignored, released on up / cancel / lost capture / blur / hidden tab / unmount). While it is down it carries data-down, so the button can show it: the
// mark is written straight to the element, so pressing a pedal never re-renders the screen.
"use client";
import { useEffect, useRef } from "react";
import { createHold } from "@/lib/pointerHold.js";

/** Stops the browser scrolling, zooming, selecting or opening a menu under a finger that is steering. */
export const NO_GESTURE = { touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent" };

/** A hold with a "pressed" look on `el` (a ref to the element). */
export function useHold(el, onDown, onUp) {
  const cb = useRef({ onDown, onUp }), hold = useRef(null);
  cb.current = { onDown, onUp };   // the newest callbacks, without making a new hold (a press in progress must survive a re-render)
  if (!hold.current) hold.current = createHold({ onDown: (e) => cb.current.onDown?.(e), onUp: (forced) => cb.current.onUp?.(forced), mark: (on) => { const b = el.current; if (!b) return; if (on) b.dataset.down = "1"; else delete b.dataset.down; } });
  useEffect(() => () => { hold.current.release(null, true); }, []);   // leaving the screen while held lets go
  return hold.current;
}

/** `keys`: Space / Enter on the focused button also hold it (the horn, climb). */
export default function Hold({ className, label, onDown, onUp, keys = false, children }) {
  const el = useRef(null), hold = useHold(el, onDown, onUp);
  return <button ref={el} type="button" className={className} style={NO_GESTURE} aria-label={label} data-sound="none" {...hold.handlers} {...(keys ? hold.keyHandlers : {})}>{children}</button>;
}
