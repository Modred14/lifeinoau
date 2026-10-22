// lib3d/tripinput.js
// Pointer input for the 3D view during a trip: drag to look round, pinch / wheel to zoom, and (when driving on a touch screen) swipe to steer.
//
// Every finger is tracked by its own pointer id, on the canvas only. That is the fix for the swipe glitches: the old code listened on `window` for every pointermove, so a finger
// holding the on-screen stick was also read as a camera drag, the two fingers' positions alternated and the camera jumped. Here a finger that did not start on the canvas is never
// read, a second finger turns the gesture into a pinch (it never also rotates the camera), and lifting one finger re-bases the other so nothing jumps.
//
// Nothing here moves anything itself: it reports gestures through callbacks, and the trip loop applies them once per frame.

const STEER_RANGE = 0.2; // a swipe of this fraction of the screen width is full lock

/**
 * el: the canvas. cb: { mode(): "look" | "steer" | "none", look(dYaw, dPitch), zoom(scale), wheel(deltaY), steer(v in -1..1) }.
 * Returns { detach(), active } (active = a finger or button is down on the canvas).
 */
export function attachTripPointer(el, cb) {
  const ptrs = new Map(); let pinchD = 0, steerId = null, steerX0 = 0;
  const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const rebase = () => { for (const p of ptrs.values()) { p.px = p.x; p.py = p.y; } pinchD = ptrs.size === 2 ? dist() : 0; };
  const endSteer = () => { if (steerId != null) { steerId = null; cb.steer?.(0); } };

  const down = (e) => {
    if (e.target !== el || (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2)) return;
    if (ptrs.size >= 2) return; // a third finger is ignored rather than fighting the other two
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, type: e.pointerType });
    try { el.setPointerCapture(e.pointerId); } catch { /* the pointer may already be gone */ }
    if (ptrs.size === 2) { endSteer(); rebase(); }
    else if (cb.mode() === "steer" && e.pointerType !== "mouse") { steerId = e.pointerId; steerX0 = e.clientX; }
    e.preventDefault();
  };
  const move = (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return; // not one of ours: ignore it
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) { const d = dist(); if (pinchD > 0) cb.zoom?.(d / pinchD); pinchD = d; p.px = p.x; p.py = p.y; return; }
    const mode = cb.mode();
    if (steerId === e.pointerId && mode === "steer") { cb.steer?.(Math.max(-1, Math.min(1, (p.x - steerX0) / (Math.max(320, innerWidth) * STEER_RANGE)))); p.px = p.x; p.py = p.y; return; }
    if (mode === "look" || (mode === "steer" && p.type === "mouse")) cb.look?.((p.x - p.px) * 0.0055, (p.y - p.py) * 0.0045);
    p.px = p.x; p.py = p.y;
  };
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId); if (steerId === e.pointerId) endSteer(); rebase();
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  const wheel = (e) => { if (cb.mode() === "none") return; e.preventDefault(); cb.wheel?.(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY); };
  const stop = (e) => e.preventDefault();
  const reset = () => { ptrs.clear(); pinchD = 0; endSteer(); };
  const hidden = () => { if (document.hidden) reset(); };

  el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);
  el.addEventListener("wheel", wheel, { passive: false }); el.addEventListener("contextmenu", stop);
  addEventListener("blur", reset); document.addEventListener("visibilitychange", hidden);
  return {
    get active() { return ptrs.size > 0; },
    detach() { reset(); el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); el.removeEventListener("lostpointercapture", up); el.removeEventListener("wheel", wheel); el.removeEventListener("contextmenu", stop); removeEventListener("blur", reset); document.removeEventListener("visibilitychange", hidden); },
  };
}
