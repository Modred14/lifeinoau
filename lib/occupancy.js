// lib/occupancy.js
// WHO IS INSIDE WHICH BUILDING, right now: the live head count shown on the map ("3 people inside"). Pure in-memory rules with no database, no sockets and no
// timers, so they are easy to test. realtime/server.js owns ONE of these, decides who may claim what (it checks the database), and pushes the changes.
// The explanation, and the rules a future change must keep, are in docs/BUILDING-OCCUPANCY.md.
//
//   * A claim is "this connection of this player is inside this building". Only real, authenticated players ever make one (the server passes the id from the
//     verified chat pass, never anything the browser typed).
//   * A player is in AT MOST ONE building. A player with several connections (two tabs) is in the place of their NEWEST claim, and is counted once, however
//     many connections claim the same building. So a player can never be counted twice, and moving straight from building A to B takes one off A and puts one on B
//     in the same step.
//   * A claim lives only while its connection does: when the connection drops (or stops reporting for ttlMs) the claim goes, so nobody stays counted forever.
//   * Every method that changes anything returns { placeId: newCount } for the places whose count changed (0 included, so a client knows to hide it). The counts
//     are absolute numbers, not +1/-1, so a message that arrives twice or late does no harm.
export const OCCUPANCY_TTL_MS = 75_000; // a connection that has not reported for this long is treated as gone (the browser reports every 20 seconds)
const MAX_CLAIMS_PER_PLAYER = 8; // a player cannot make the server remember an unlimited number of connections

export function createOccupancy({ ttlMs = OCCUPANCY_TTL_MS, now = Date.now } = {}) {
  const claims = new Map(); // playerId -> Map(socketId -> { place, since, seen })
  const where = new Map(); // playerId -> the building they are counted in
  const counts = new Map(); // placeId -> players inside (never holds 0)

  const bump = (place, by, changed) => {
    const n = (counts.get(place) ?? 0) + by;
    if (n > 0) counts.set(place, n); else counts.delete(place);
    changed[place] = Math.max(0, n);
  };

  // Work out where a player is counted from their claims, and move the counts if that changed.
  function settle(playerId, changed) {
    const mine = claims.get(playerId);
    let place = null, since = -Infinity;
    if (mine) for (const c of mine.values()) if (c.since >= since) { since = c.since; place = c.place; } // the newest claim wins (ties: the later one made)
    if (mine && !mine.size) claims.delete(playerId);
    const before = where.get(playerId) ?? null;
    if (before === place) return;
    if (before) bump(before, -1, changed);
    if (place) { bump(place, +1, changed); where.set(playerId, place); } else where.delete(playerId);
  }

  // A place that went up and down within one call (A -> B -> A) is not a change: drop entries whose final count equals what it was.
  const net = (changed, was) => { for (const p of Object.keys(changed)) if (changed[p] === (was.get(p) ?? 0)) delete changed[p]; return changed; };
  const snap = (...places) => new Map(places.map((p) => [p, counts.get(p) ?? 0]));

  return {
    /** This connection of this player is now inside `place` (also used to move to another building, or to say it again after the server forgot). */
    claim(playerId, socketId, place) {
      const t = now(), changed = {}, was = snap(...new Set([where.get(playerId), place].filter(Boolean)));
      let mine = claims.get(playerId);
      if (!mine) claims.set(playerId, (mine = new Map()));
      const have = mine.get(socketId);
      if (have && have.place === place) have.seen = t; // the same thing said again: nothing moves
      else {
        if (!have && mine.size >= MAX_CLAIMS_PER_PLAYER) { // too many connections: forget the one that reported longest ago
          let oldest = null; for (const [k, c] of mine) if (!oldest || c.seen < mine.get(oldest).seen) oldest = k;
          mine.delete(oldest);
        }
        mine.set(socketId, { place, since: t, seen: t });
      }
      settle(playerId, changed);
      return net(changed, was);
    },
    /** This connection is still alive and still where it said. False when the server does not know it (it restarted, or the claim expired): the client then claims again. */
    beat(playerId, socketId) {
      const c = claims.get(playerId)?.get(socketId);
      if (!c) return false;
      c.seen = now();
      return true;
    },
    /** This connection stepped out (or went away). Same thing: its claim is forgotten and the player is counted wherever their other connections say, or nowhere. */
    release(playerId, socketId) {
      const mine = claims.get(playerId);
      if (!mine?.delete(socketId)) return {};
      const changed = {}, was = snap(...new Set([where.get(playerId)].filter(Boolean)));
      settle(playerId, changed);
      return net(changed, was);
    },
    /** Forget every claim that has not reported within ttlMs. Call it now and then; the server does it every few seconds. */
    sweep() {
      const cut = now() - ttlMs, changed = {}, was = snap(...counts.keys());
      for (const [playerId, mine] of [...claims]) {
        let any = false;
        for (const [k, c] of [...mine]) if (c.seen < cut) { mine.delete(k); any = true; }
        if (any) settle(playerId, changed);
      }
      return net(changed, was);
    },
    /** The buildings that have somebody inside, and how many: { placeId: n }, only counts above zero. */
    snapshot: () => Object.fromEntries(counts),
    /** How many players are counted inside `place` (0 when nobody). */
    count: (place) => counts.get(place) ?? 0,
    /** Where this player is counted, or null. */
    placeOf: (playerId) => where.get(playerId) ?? null,
    /** Players counted inside any building right now. */
    get inside() { return where.size; },
  };
}

/** Merge a set of changes into one (later wins), for sending a burst as a single message. */
export const mergeChanges = (into, more) => Object.assign(into, more);
