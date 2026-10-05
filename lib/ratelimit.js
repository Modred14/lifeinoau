// lib/ratelimit.js
// Postgres-backed fixed-window rate limiter: shared by every server instance, atomic under concurrency.
export const windowOf = (now, ms) => new Date(Math.floor(now / ms) * ms);

/** Count one hit for `key` in the current window and return the new count. */
export async function hit(db, key, ms, now = Date.now()) {
  const w = windowOf(now, ms);
  const [r] = await db.$queryRaw`INSERT INTO "RateLimit" ("key","windowStart","count") VALUES (${key}, ${w}, 1)
    ON CONFLICT ("key","windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1 RETURNING "count"`;
  if (Math.random() < 0.01) db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now - 86_400_000) } } }).catch(() => {});
  return Number(r.count);
}
/** True if the caller is still within `max` hits per `ms`. */
export async function allowed(db, key, max, ms, now) { return (await hit(db, key, ms, now)) <= max; }
export const tooMany = () => Response.json({ error: "Too many requests. Wait a moment and try again." }, { status: 429, headers: { "Retry-After": "60" } });
/** Only trust x-forwarded-for when the app sits behind a proxy you control (Vercel, Nginx...). */
export const ipOf = (req) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
