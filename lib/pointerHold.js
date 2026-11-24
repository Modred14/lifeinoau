// lib/pointerHold.js
// "Held" for an on-screen driving control (a pedal, a steering pad, the horn, climb / descend). One small state machine, used by EVERY touch / mouse control of a vehicle
// (components/HoldButton.js, components/SteerButtons.js, components/DrivePad.js), so they all behave the same and a control can never stay pressed.
//
// What it guarantees, for each control:
//   - it follows ONE pointer: the first finger (or the left mouse button) that goes down on it. A second finger on the same control is ignored, and lifting that second finger never
//     releases the first. Other controls are independent, so gas + steer + horn can be held by three fingers at once.
//   - a right or middle mouse button is never a press (a right-click would otherwise hold the gas and open the context menu at the same time).
//   - it lets go on pointer up, pointer cancel (the browser took the touch for a gesture, a call came in, the palm was rejected) and lost pointer capture.
//   - it lets go of EVERYTHING when the window loses focus, the tab is hidden or the page is being left, because a finger that is lifted while the browser is not watching never
//     sends its pointer up. (One listener set for the whole page, wired the first time something is pressed, not one per button.)
//   - the keyboard works too, for the controls that ask for it: Space / Enter held on a focused control, released on key up or when it loses focus.
// It touches no React state: `mark(on)` (the "pressed" look) is written straight to the element by the caller, so pressing a pedal never re-renders anything.
// Pure JS: the events only need pointerId, pointerType, button, currentTarget.setPointerCapture and preventDefault, so it runs headless in the tests.

const live = new Set();
let wired = false;

/** Let go of every control that is held right now (window blur, hidden tab, page hide, leaving a vehicle). Safe to call at any time. */
export function releaseAllHolds() { for (const h of [...live]) h.release(null, true); }

function wire() {
  if (wired || typeof window === "undefined") return; wired = true;
  window.addEventListener("blur", releaseAllHolds);
  window.addEventListener("pagehide", releaseAllHolds);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAllHolds(); });
}

/** How many controls are held right now (for the tests, and for "is anything held"). */
export const heldCount = () => live.size;

/**
 * A holdable control. onDown(e): it was pressed. onUp(forced): it was let go (forced = true when the page made it let go: blur, hidden, unmounted). mark(on): show / hide the pressed look.
 * Returns { press(e), release(e?, forced?), held, pointerId, handlers, keyHandlers }. `handlers` are the pointer props to spread on a button; `keyHandlers` the keyboard ones.
 */
export function createHold({ onDown, onUp, mark } = {}) {
  let id = null;
  const hold = {
    get held() { return id != null; },
    get pointerId() { return id; },
    /** A pointer went down on the control. Returns true when it took the press (false: a second finger, or not the primary button). */
    press(e) {
      if (id != null) return false;
      if (e.pointerType === "mouse" && e.button !== 0) return false;
      id = e.pointerId ?? "p"; wire(); live.add(hold);
      try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch { /* the pointer may already be gone */ }
      mark?.(true); onDown?.(e); return true;
    },
    /** Let go. With an event: only if it is the pointer that holds the control. Without one: always (when held). Returns true if it released something. */
    release(e, forced = false) {
      if (id == null) return false;
      if (e && e.pointerId !== id) return false;
      id = null; live.delete(hold); mark?.(false); onUp?.(forced); return true;
    },
    handlers: {
      onPointerDown: (e) => { if (hold.press(e)) e.preventDefault?.(); },
      onPointerUp: (e) => { hold.release(e); },
      onPointerCancel: (e) => { hold.release(e); },
      onLostPointerCapture: (e) => { hold.release(e); },
      onContextMenu: (e) => e.preventDefault?.(),
    },
    keyHandlers: {
      onKeyDown: (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat && id == null) { id = "key"; wire(); live.add(hold); mark?.(true); onDown?.(e); e.preventDefault?.(); } else if (e.key === " " || e.key === "Enter") e.preventDefault?.(); },
      onKeyUp: (e) => { if ((e.key === " " || e.key === "Enter") && id === "key") hold.release(null); },
      onBlur: () => { if (id === "key") hold.release(null, true); },
    },
  };
  return hold;
}
