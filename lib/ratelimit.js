// lib/ratelimit.js
// Two kinds of limiter, because a database write on EVERY request is exactly what makes a busy site slow:
//  - Sensitive keys (login, signup, character creation, hostel pick) are counted in Postgres, so every server instance agrees.
//  - Everything else (state, actions, room, phone apps...) is counted in memory: no database round trip at all.
//    On several instances each one counts on its own, which is plenty to stop a runaway script.
export const windowOf = (now, ms) => new Date(Math.floor(now / ms) * ms);

/** Count one hit for `key` in the current window and return the new count. (Postgres: shared by every server instance, atomic under concurrency.) */
export async function hit(db, key, ms, now = Date.now()) {
  const w = windowOf(now, ms);
  const [r] = await db.$queryRaw`INSERT INTO "RateLimit" ("key","windowStart","count") VALUES (${key}, ${w}, 1)
    ON CONFLICT ("key","windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1 RETURNING "count"`;
  if (Math.random() < 0.01) db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now - 86_400_000) } } }).catch(() => {});
  return Number(r.count);
}

const SHARED = /^(login|signup|char:|host:)/;
const mem = new Map(); // key -> { w, n }
let swept = 0;
function memHit(key, ms, now) {
  const w = Math.floor(now / ms);
  if (now - swept > 60_000 || mem.size > 100_000) { // drop finished windows now and then so the map cannot grow forever
    swept = now;
    for (const [k, v] of mem) if (v.end <= now) mem.delete(k);
    if (mem.size > 100_000) mem.clear();
  }
  const e = mem.get(key);
  if (e && e.w === w) return ++e.n;
  mem.set(key, { w, n: 1, end: (w + 1) * ms });
  return 1;
}

/** True if the caller is still within `max` hits per `ms`. */
export async function allowed(db, key, max, ms, now = Date.now()) {
  return (SHARED.test(key) ? await hit(db, key, ms, now) : memHit(key, ms, now)) <= max;
}
export const tooMany = () => Response.json({ error: "Too many requests. Wait a moment and try again." }, { status: 429, headers: { "Retry-After": "60" } });
/** Only trust x-forwarded-for when the app sits behind a proxy you control (Vercel, Nginx...). */
export const ipOf = (req) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";