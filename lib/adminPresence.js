// lib/adminPresence.js
// WHO IS REALLY HERE. "Last active a few minutes ago" is not "online", so presence is decided from live evidence only:
//
//   socket     the chat's realtime server holds an open WebSocket for this player (asked of the server itself, signed; see realtime/server.js "online").
//              Only available while REALTIME_URL points at a running realtime server.
//   position   the game screen's own heartbeats: it reports where the player stands every 4 s inside a building (inAt), every few seconds on the
//              road (tripAt) and once a minute on the map (placeAt). Each one is only trusted while fresh.
//   request    a signed-in request in the last few minutes (User.lastActiveAt). A tab that is on screen asks the server for the game state every minute;
//              a hidden tab stops, which is exactly what makes it idle.
//
//   ONLINE         a fresh heartbeat or request: the game is open and in use.
//   IDLE           a WebSocket is open but the game has made no request for a while (a background tab).
//   DISCONNECTED   nothing live now, but a signal in the last 15 minutes: the connection dropped recently and may come back.
//   OFFLINE        nothing for 15 minutes or more.
// Without a realtime server there is no `socket` evidence; the states then come from heartbeats and requests alone, and the dashboard says so.
import { askRealtime } from "./realtimeNotify.js";
import { placeName } from "./adminPlaces.js";

export const FRESH = { inside: 30_000, trip: 30_000, map: 90_000, request: 180_000 };
export const RECENT_MS = 15 * 60_000;
const ms = (d) => (d == null ? null : +new Date(d));
const within = (t, now, win) => t != null && now - t >= -5_000 && now - t <= win;

/** Pure: the verdict from the evidence. `socket` is true/false when the realtime server was asked, null when it could not be. */
export function presenceOf({ socket = null, placeAt, inAt, tripAt, lastActiveAt, seenAt }, now = Date.now()) {
  const inside = within(ms(inAt), now, FRESH.inside), trip = within(ms(tripAt), now, FRESH.trip), map = within(ms(placeAt), now, FRESH.map), req = within(ms(lastActiveAt), now, FRESH.request);
  const sources = [socket === true && "socket", (inside || trip || map) && "heartbeat", req && "request"].filter(Boolean);
  const last = Math.max(0, ...[placeAt, inAt, tripAt, lastActiveAt, seenAt].map(ms).filter((x) => x != null));
  let state;
  if (inside || trip || map || req) state = "ONLINE";
  else if (socket === true) state = "IDLE";
  else if (last && now - last <= RECENT_MS) state = "DISCONNECTED";
  else state = "OFFLINE";
  return { state, sources, lastSignalAt: last ? new Date(last) : null, moving: trip, inside };
}

/** The game-side conditions an administrator wants beside the presence: custody, discipline, sleep, travel. */
export function conditionOf(c, now = Date.now()) {
  const tags = [];
  if (ms(c.jailedUntil) > now) tags.push("In custody");
  if (ms(c.suspendedUntil) > now) tags.push("Suspended (academic)");
  if (c.expelled && (c.expelledUntil == null || ms(c.expelledUntil) > now)) tags.push("Expelled");
  if (c.sleepingSince) tags.push("Asleep");
  if (within(ms(c.tripAt), now, FRESH.trip)) tags.push(c.tripMode ? `Travelling (${c.tripMode})` : "Travelling");
  if (c.graduated) tags.push("Graduated");
  return tags;
}

/** Who has an open socket right now: a Set of character ids, or null when the realtime server is not configured or cannot be reached. */
export async function liveSockets() {
  const r = await askRealtime({ type: "online" });
  return r && Array.isArray(r.ids) ? new Set(r.ids.filter((x) => typeof x === "string")) : null;
}

export const ONLINE_SELECT = `
  u.id AS "userId", u.email, u."createdAt" AS "registeredAt", u."lastLoginAt", u."lastActiveAt", u.status AS "accountStatus", u."statusUntil",
  c.id AS "characterId", c.name, c.gender::text AS gender, c.class::text AS class, c.level, c.graduated, c.health, c.energy, c.happiness, c.look,
  c."placeId", c."placeAt", c."inPlace", c."inAt", c."tripAt", c."tripMode", c."jailedUntil", c."suspendedUntil", c.expelled, c."expelledUntil", c."sleepingSince",
  f.name AS faculty, a.balance::text AS balance, p."lastSeen" AS "seenAt"`;
export const ONLINE_FROM = `
  FROM "Character" c JOIN "User" u ON u.id = c."userId" JOIN "Faculty" f ON f.id = c."facultyId"
  LEFT JOIN "Account" a ON a."characterId" = c.id LEFT JOIN "Presence" p ON p."characterId" = c.id`;

/** One query row -> the shape the dashboard shows. */
export function shapePlayer(r, live, now = Date.now()) {
  const p = presenceOf({ socket: live ? live.has(r.characterId) : null, placeAt: r.placeAt, inAt: r.inAt, tripAt: r.tripAt, lastActiveAt: r.lastActiveAt, seenAt: r.seenAt }, now);
  const standing = ms(r.jailedUntil) > now ? "floor0" : r.inPlace || r.placeId || "";
  return {
    userId: r.userId, characterId: r.characterId, name: r.name, publicId: String(r.characterId).slice(-8), gender: r.gender, class: r.class, level: r.level, faculty: r.faculty,
    look: r.look ?? null, registeredAt: r.registeredAt, lastLoginAt: r.lastLoginAt, lastActiveAt: p.lastSignalAt, balance: r.balance ?? "0",
    health: r.health, energy: r.energy, happiness: r.happiness, accountStatus: effectiveStatus(r.accountStatus, r.statusUntil, now),
    presence: p.state, sources: p.sources, location: placeName(standing), locationId: standing, conditions: conditionOf(r, now),
  };
}

export function effectiveStatus(status, until, now = Date.now()) {
  if (status === "DELETED") return "DELETED";
  if (status === "SUSPENDED" && (until == null || ms(until) > now)) return "SUSPENDED";
  return "ACTIVE";
}

/** Everyone with a signal in the last 15 minutes (or an open socket), with their presence verdict. */
export async function presenceList(db, { now = Date.now(), live = undefined } = {}) {
  const sockets = live === undefined ? await liveSockets() : live;
  const since = new Date(now - RECENT_MS);
  const rows = await db.$queryRawUnsafe(
    `SELECT ${ONLINE_SELECT} ${ONLINE_FROM}
     WHERE u.status <> 'DELETED' AND (u."lastActiveAt" > $1 OR c."placeAt" > $1 OR c."tripAt" > $1 OR c."inAt" > $1 OR p."lastSeen" > $1 OR c.id = ANY($2::text[]))`,
    since, [...(sockets ?? [])]);
  const list = rows.map((r) => shapePlayer(r, sockets, now));
  const order = { ONLINE: 0, IDLE: 1, DISCONNECTED: 2, OFFLINE: 3 };
  list.sort((a, b) => order[a.presence] - order[b.presence] || String(a.name).localeCompare(String(b.name)));
  const counts = { ONLINE: 0, IDLE: 0, DISCONNECTED: 0, OFFLINE: 0 };
  for (const p of list) counts[p.presence]++;
  return { players: list, counts, realtime: sockets ? { connected: true, sockets: sockets.size } : { connected: false }, at: new Date(now) };
}
