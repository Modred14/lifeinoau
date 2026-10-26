// lib3d/keysteer.js
// Steering from the keyboard. A key is on or off, a steering wheel is not: if A or D went straight to full lock, a tap would throw the car sideways, a car at speed could not hold
// a line, and from a standstill the car would run into the kerb in the first metre. So the keys move a steering value (-1..1, +1 = right) towards full lock at a limited rate, and
// let it go back to straight a little faster. A short tap is a small correction, holding the key is a full turn, and pressing the other way swings through the middle quickly.
// The car's own physics (lib3d/carphysics.js) still limits how fast the front wheels turn and how far at speed; this only decides how much of that the keys ask for.
// Pure maths, so it is tested headless (tests/trip-controls.test.mjs).

/** Per second: `rise` towards a held key, `fall` back to straight when none is held, `flip` when the other key is pressed while still turned the other way. */
export const KEY_STEER = { rise: 2.8, fall: 5.5, flip: 8 };

/** One step of the keyboard steering value. cur: -1..1 now; dir: -1 (left key), 0 (none or both), +1 (right key); dt: seconds. */
export function stepKeySteer(cur, dir, dt, cfg = KEY_STEER) {
  if (!(dt > 0)) return cur;
  const want = dir > 0 ? 1 : dir < 0 ? -1 : 0, against = want !== 0 && cur !== 0 && Math.sign(cur) !== want, rate = want === 0 ? cfg.fall : against ? cfg.flip : cfg.rise, d = want - cur, m = rate * dt;
  return Math.abs(d) <= m ? want : cur + Math.sign(d) * m;
}
