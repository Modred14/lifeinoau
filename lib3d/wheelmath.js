// lib3d/wheelmath.js
// The maths of the on-screen steering wheel (components/SteeringWheel.js), pure so it can be tested.
/** How far the wheel turns lock to lock, each way (radians): about 105 degrees, comfortable for a thumb. */
export const WHEEL_LOCK = 1.85, WHEEL_DEADZONE = 0.04;
/** The steering value (-1..1) for a wheel angle (radians). A small dead zone around the middle, then linear to full lock. */
export function steerFromAngle(a) {
  const k = Math.max(-1, Math.min(1, a / WHEEL_LOCK)), m = Math.abs(k);
  return m < WHEEL_DEADZONE ? 0 : Math.sign(k) * ((m - WHEEL_DEADZONE) / (1 - WHEEL_DEADZONE));
}
/** The shortest signed difference between two angles. */
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
