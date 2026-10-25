// lib/busyPlaces.js
// WHICH PLACES ARE BUSY. Pure rules (no database), so they are easy to test; lib/travelService.js (busyPlaces) loads the counts and calls these.
//
// The server already knows where every online player stands: the map reports it every minute (Character.placeId / placeAt) and a building reports the exact
// spot every few seconds (inPlace / inAt). This turns "how many players are at each place" into "which places are busy", and nothing more: the answer
// is a short list of places. It never carries a head count, a name or a position, so nobody can read who is where from it.
//
// A place is busy when BOTH hold:
//   - at least `minPlayers` players are gathered there (a floor, so two friends meeting is not "a lot of people"), and
//   - at least `minShare` of everybody gathered anywhere is there (adaptive: on a busy night 3 players at a place is nothing, in a quiet hour it is a crowd).
// Both can be tuned without a deploy: BUSY_MIN_PLAYERS and BUSY_MIN_SHARE.
export const BUSY_DEFAULTS = Object.freeze({ minPlayers: 3, minShare: 0.2, maxPlaces: 3 });

/** A player on the road (driving, riding or walking a trip, reported within this long ago) is passing by, not gathered anywhere. */
export const ROAD_FRESH_MS = 30_000;

const num = (v, ok, fallback) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && ok(n) ? n : fallback; };

/** The thresholds in force: the defaults, overridden by BUSY_MIN_PLAYERS / BUSY_MIN_SHARE when those hold sensible values. */
export function busyConfig(env = typeof process !== "undefined" ? process.env : {}) {
  return {
    minPlayers: Math.floor(num(env.BUSY_MIN_PLAYERS, (n) => n >= 2 && n <= 1000, BUSY_DEFAULTS.minPlayers)),
    minShare: num(env.BUSY_MIN_SHARE, (n) => n >= 0 && n <= 1, BUSY_DEFAULTS.minShare),
    maxPlaces: BUSY_DEFAULTS.maxPlaces,
  };
}

/** How many players a place needs before it counts as busy, given how many are gathered in the whole world right now. */
export const busyThreshold = (total, cfg = busyConfig()) => Math.max(cfg.minPlayers, Math.ceil(total * cfg.minShare));

/**
 * counts: { placeId: gathered players } (everyone counted once). Returns the busy place ids, busiest first (ties by id), at most cfg.maxPlaces.
 * exclude: ids never returned (the place the caller is standing in). eligible(id): false for a place that must not be named (no name, a billboard, custody).
 * `total` is everybody gathered anywhere, including at excluded or unnamed places, so the adaptive share reflects the whole world.
 */
export function busyIds(counts, { cfg = busyConfig(), exclude = [], eligible = () => true } = {}) {
  const entries = Object.entries(counts ?? {}).filter(([id, n]) => id && Number.isFinite(n) && n > 0);
  const total = entries.reduce((t, [, n]) => t + n, 0), need = busyThreshold(total, cfg), skip = new Set(exclude.filter(Boolean));
  return entries
    .filter(([id, n]) => n >= need && !skip.has(id) && eligible(id))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, cfg.maxPlaces)
    .map(([id]) => id);
}
