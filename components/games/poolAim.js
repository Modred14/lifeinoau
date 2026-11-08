// components/games/poolAim.js: the small pure pieces of the pool cue interaction (no React, no canvas) so they can be tested on their own.
// Everything here is in TABLE units (x along the long side, angle 0 = +x, angles grow towards +y), the same space the server simulates in.
export const MAX_PULL = 110; // how far the cue can be drawn back from its rest spot, in table units: full power
export const CUE_LEN = 300; // drawn length of the stick
export const TIP_GAP = 6; // the tip rests this far off the ball's edge at zero pull
export const FIRE_MIN = 0.05; // a pull shorter than this is a cancel, not a shot (the server's own floor is 0.03)
export const MIN_AIM_DIST = 18; // a pointer closer than this to the cue ball gives a wild angle: keep the old one

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Power 0..1 <-> pull-back in table units (linear, as simulate() maps power linearly onto the cue ball's speed). */
export const powerToPull = (p) => clamp(p, 0, 1) * MAX_PULL;
export const pullToPower = (d) => clamp(d, 0, MAX_PULL) / MAX_PULL;

/** The aim angle from the cue ball to a pointer, or `keep` when the pointer is too close to say. */
export function aimAngle(cue, p, keep) {
  const dx = p[0] - cue.x, dy = p[1] - cue.y;
  return Math.hypot(dx, dy) < MIN_AIM_DIST ? keep : Math.atan2(dy, dx);
}

/** How far a point sits behind the cue ball along the direction opposite to the aim (negative: in front of it). */
export const backDistance = (cue, aim, p) => (cue.x - p[0]) * Math.cos(aim) + (cue.y - p[1]) * Math.sin(aim);

/** The stick as a segment: tip end and butt end, `r` = ball radius. */
export function cueSegment(cue, aim, r, pull) {
  const c = Math.cos(aim), s = Math.sin(aim), a = r + TIP_GAP + pull, z = a + CUE_LEN;
  return [[cue.x - c * a, cue.y - s * a], [cue.x - c * z, cue.y - s * z]];
}

/** Shortest distance from a point to a segment. */
export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Is the pointer on the stick? `tol` is the reach in table units (the caller converts a finger-sized number of pixels). */
export const onCue = (cue, aim, r, pull, p, tol) => { const [a, b] = cueSegment(cue, aim, r, pull); return distToSegment(p, a, b) <= tol; };

/** The pull for a pointer that grabbed the stick at `grabBack` (its backDistance then) when the pull was `pull0`: the stick follows the finger along its own axis. */
export const pullFor = (cue, aim, p, grabBack, pull0) => clamp(pull0 + backDistance(cue, aim, p) - grabBack, 0, MAX_PULL);

/** The speed the server will give the cue ball, for tests of the power mapping. */
export const speedOf = (power, vmin = 160, vmax = 1800) => vmin + (vmax - vmin) * clamp(power, 0, 1);
