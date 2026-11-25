// lib3d/camera/cameraRig.js
// Shared, pure camera maths (no three.js, no DOM) so it can be unit-tested: obstruction sweep, asymmetric smoothing, blocked-view pitch, device framing.
// Every number a camera mode uses lives in CAMERA_CONFIG, not scattered through the scene code.

export const CAMERA_CONFIG = {
  interior: {
    pad: 0.22,          // metres kept between the camera and any wall
    side: 0.35,         // the sweep also casts this far to each side of the centre ray, so corners are cleared as well as flat walls
    minFrac: 0.12,      // the camera never collapses closer than this fraction of its wanted distance (it rises over the player instead)
    inRate: 20,         // per second: pulled in fast enough that a wall never shows
    outRate: 2.4,       // per second: eases back out slowly (no pumping)
    outHold: 0.3,       // seconds a clear view must hold before the camera starts easing out (stops zoom in/out against one obstacle)
    posRate: 14, lookRate: 9,
    blockedPitch: 1.15, // when walled in, the camera tilts up towards this pitch and looks down at the player
    hideBelow: 0.7, showAbove: 0.95, // the player model hides only when the camera is really inside it (hysteresis, so it never flickers)
    fov: { landscape: 62, portrait: 70, ultrawide: 58, overhead: 45 },
  },
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Frame-rate independent approach of `cur` to `want` at `rate` per second. */
export const damp = (cur, want, rate, dt) => cur + (want - cur) * (1 - Math.exp(-rate * Math.max(0, dt)));

/**
 * The fraction (0..1) of the wanted camera run that is free of obstacles. `clip(ax, az, bx, bz, pad)` returns the first hit in 0..1 (1 = clear), like rayClip.
 * Three rays (centre, left, right) so the camera cannot clip a corner the centre ray slips past.
 */
export function sweepClear(clip, px, pz, dx, dz, pad, side) {
  const len = Math.hypot(dx, dz); if (len < 1e-6) return 1;
  const rx = -dz / len, rz = dx / len; let best = 1;
  for (const o of [0, -side, side]) {
    const ax = px + rx * o, az = pz + rz * o, t = clip(ax, az, ax + dx, az + dz, pad);
    if (t < best) best = t;
  }
  return best;
}

/**
 * One step of the obstruction fraction: in fast, out slowly and only after the view has stayed clear for `outHold` seconds.
 * `s` is { v, hold } and is mutated and returned; start it as { v: 1, hold: 0 }.
 */
export function stepClearance(s, target, dt, cfg = CAMERA_CONFIG.interior) {
  if (!Number.isFinite(target)) target = 1;
  target = clamp(target, cfg.minFrac, 1);
  if (target < s.v) { s.v = damp(s.v, target, cfg.inRate, dt); s.hold = 0; if (s.v < target) s.v = target; }
  else { s.hold += dt; if (s.hold >= cfg.outHold) s.v = damp(s.v, target, cfg.outRate, dt); }
  return s;
}

/** Walled in: raise the camera's pitch toward `blockedPitch` as the view is squeezed (frac -> small), so it looks down on the player instead of sitting in their head. */
export function blockedPitch(pitch, frac, cfg = CAMERA_CONFIG.interior) {
  const squeeze = clamp((1 - frac) / (1 - cfg.minFrac), 0, 1);
  return pitch + (Math.max(pitch, cfg.blockedPitch) - pitch) * squeeze;
}

/** Show/hide with hysteresis: `prev` is the current visibility. */
export const hysteresis = (prev, value, lo, hi) => (prev ? value > lo : value > hi);

/** Field of view for the screen shape: phones held upright need a wider view to keep the same width of world on screen. */
export function fovFor(aspect, mode = "landscape", cfg = CAMERA_CONFIG.interior) {
  if (mode === "overhead") return aspect < 1 ? cfg.fov.overhead + 8 : cfg.fov.overhead;
  if (!(aspect > 0)) return cfg.fov.landscape;
  if (aspect < 0.9) return cfg.fov.portrait;
  if (aspect > 2.1) return cfg.fov.ultrawide;
  return cfg.fov.landscape;
}
