// lib/accountGate.js
// Is this account allowed to use the game right now? One answer, used by getUserId() (so EVERY API route enforces it), by login, and by the admin console.
//
//   ACTIVE      yes
//   SUSPENDED   no, until `statusUntil` (or until an administrator restores it when there is no end date). A timed suspension ends by itself:
//               it is decided by comparing the stored deadline with the clock, so nothing has to run to lift it.
//   DELETED     no. The account is archived, never erased: the user row, character, ledger and history stay, so money still adds up and the
//               account can be restored. Its email stays registered, so it cannot simply sign up again.
//
// Reading it costs one small query per player per few seconds per server (a short in-memory cache), and the same read keeps `lastActiveAt` fresh
// (written at most once every two minutes), which is what the admin dashboard uses to tell who is really here.
export const GATE_TTL_MS = 8_000;
export const TOUCH_EVERY_MS = 120_000;

const ms = (d) => (d == null ? null : +new Date(d));

/** Pure: the verdict for a user row (status, statusUntil, statusReason). */
export function gateOf(u, now = Date.now()) {
  if (!u) return { ok: false, code: "MISSING", message: "Please log in again." };
  if (u.status === "DELETED") return { ok: false, code: "DELETED", message: "This account has been closed." };
  if (u.status === "SUSPENDED" && (u.statusUntil == null || ms(u.statusUntil) > now))
    return { ok: false, code: "SUSPENDED", until: u.statusUntil ?? null, reason: u.statusReason ?? null, message: suspendedNotice(u, now) };
  return { ok: true, code: "OK" };
}

export function suspendedNotice(u, now = Date.now()) {
  const until = u.statusUntil == null ? null : new Date(u.statusUntil);
  const when = until ? ` until ${until.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}` : " until an administrator restores it";
  return `This account is suspended${when}.${u.statusReason ? ` Reason: ${String(u.statusReason).slice(0, 80)}` : ""}`; // short: the app hides server messages over 200 characters
}

const cache = new Map(); // userId -> { at, gate }

/** The verdict for a user id, cached for a few seconds. Fails OPEN on a database error: the game's own queries would fail too, and a blip must not log everyone out. */
export async function checkAccount(db, userId, now = Date.now(), { touch = true } = {}) {
  const hit = cache.get(userId);
  if (hit && now - hit.at < GATE_TTL_MS) return hit.gate;
  let u;
  try {
    u = await db.user.findUnique({ where: { id: userId }, select: { id: true, status: true, statusUntil: true, statusReason: true, lastActiveAt: true } });
  } catch (e) {
    console.error("[accountGate]", e?.message ?? e);
    return { ok: true, code: "OK", unchecked: true };
  }
  const gate = gateOf(u, now);
  if (cache.size > 20_000) cache.clear();
  cache.set(userId, { at: now, gate });
  if (gate.ok && touch && u && (u.lastActiveAt == null || now - ms(u.lastActiveAt) > TOUCH_EVERY_MS))
    Promise.resolve(db.user.update({ where: { id: userId }, data: { lastActiveAt: new Date(now) } })).catch(() => {});
  return gate;
}

/** Drop the cached verdict: an administrator just changed this account, so this server stops waiting for the cache to expire. */
export const forgetAccount = (userId) => { cache.delete(userId); };
export const clearAccountCache = () => cache.clear();
