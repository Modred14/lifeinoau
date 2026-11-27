// lib/homeCamera.js
// Pure maths for the home camera (no three.js, no DOM), so it can be unit-tested. Per-accommodation settings, the zoom limit that keeps the player small, and the
// "is something standing between the camera and the player" test used to fade furniture.

export const PLAYER_HEIGHT = 1.75;       // metres, the avatar
export const PLAYER_MAX_FRAC = 0.15;     // the player takes no more than this fraction of the screen's height (except in a room too small to fit at that zoom)

/**
 * Camera tuning by the size of the home's floor plan (cells; one cell is about 0.9 m). A compact room (school hostel, Ojaja) sits closer to top-down so no wall or
 * piece hides the player in the narrow space; a flat or a house can be seen at a lower angle, with more of the rooms in the picture.
 *  polarMin/polarMax: the angle from straight up the camera may tilt to (0 = looking straight down). zoomIn: nearest allowed distance as a fraction of the fitted distance.
 */
export const HOME_CAMERAS = {
  compact: { polarMin: 0.5, polarMax: 1.05, zoomIn: 0.62, fade: 0.16 },
  medium:  { polarMin: 0.62, polarMax: 1.15, zoomIn: 0.55, fade: 0.18 },
  large:   { polarMin: 0.72, polarMax: 1.22, zoomIn: 0.5,  fade: 0.2 },
};
export function homeCameraFor(room) {
  const cells = (room?.w ?? 9) * (room?.d ?? 7), kind = cells <= 110 ? "compact" : cells <= 260 ? "medium" : "large";
  return { kind, ...HOME_CAMERAS[kind] };
}

/** The nearest the camera may stand so the player is at most `frac` of the screen's height: height / (2 * d * tan(fov / 2)) <= frac. */
export function minDistForPlayer(fovDeg, frac = PLAYER_MAX_FRAC, h = PLAYER_HEIGHT) {
  return h / (2 * frac * Math.tan((fovDeg * Math.PI) / 360));
}

/** The zoom-in limit: the player-size limit, but never closer than the config allows nor farther than the fitted view itself (a tiny room still fills the screen). */
export function zoomLimits(fitDist, fovDeg, cfg) {
  const lo = fitDist * cfg.zoomIn, hi = fitDist * 0.95;
  return { min: Math.min(hi, Math.max(lo, minDistForPlayer(fovDeg))), playerMin: minDistForPlayer(fovDeg) };
}

/** Fraction of the screen's height the player takes at `dist`. */
export const playerScreenFrac = (dist, fovDeg, h = PLAYER_HEIGHT) => h / (2 * dist * Math.tan((fovDeg * Math.PI) / 360));

/**
 * Does the box [min, max] stand between the camera `c` and the point `p` on the player (not containing the player, and not merely behind them)?
 * Slab test along the segment c -> p; `slack` metres short of the player are ignored so a piece the player stands against does not flicker.
 */
export function blocksView(c, p, min, max, slack = 0.35) {
  const inside = p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && p[2] >= min[2] && p[2] <= max[2];
  if (inside) return false;
  const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], len = Math.hypot(...d); if (len < 1e-6) return false;
  let t0 = 0, t1 = 1 - slack / len;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (c[i] < min[i] || c[i] > max[i]) return false; continue; }
    let a = (min[i] - c[i]) / d[i], b = (max[i] - c[i]) / d[i]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
  }
  return true;
}
