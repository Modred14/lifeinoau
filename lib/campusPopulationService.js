// lib/campusPopulationService.js
// Loads and writes the numbers behind the header's campus population. The rules (formula, size of an arrival, day key) are in lib/campusPopulation.js;
// the feature is explained in docs/CAMPUS-POPULATION.md. Everything here is SIMULATED bookkeeping in its own two tables (CampusArrivalDay, CampusEntry):
// nothing here reads a player's analytics and nothing here writes into them.
import { roll } from "./rng.js"; // the operating system's secure generator: a browser can never influence the draw
import { cached } from "./cache.js";
import { dayKey, arrivalSize, populationOf, entryCooldownMs } from "./campusPopulation.js";

const REGISTERED_TTL_MS = 30_000; // the real account count changes slowly; one count is shared by everybody asking within this time

/**
 * How many REAL accounts are registered (archived/deleted accounts are not counted). One row per account, so nobody is counted twice,
 * and it is a count of accounts, not of who is online: online players are already among them.
 */
export async function registeredAccounts(db, { ttlMs = REGISTERED_TTL_MS } = {}) {
  return cached("campus:registered", ttlMs, async () => {
    const [r] = await db.$queryRaw`SELECT COUNT(*)::int AS n FROM "User" WHERE "status" <> 'DELETED'`;
    return Number(r?.n ?? 0);
  });
}

async function arrivalsOn(q, day) {
  const rows = await q.$queryRaw`SELECT "arrivals" FROM "CampusArrivalDay" WHERE "day" = ${day}`;
  return Number(rows[0]?.arrivals ?? 0); // a day nobody has entered yet has no row: 0
}

/** The number for the header, with its parts (the parts are for the server and for tests: the browser is only told `people`). */
export async function getPopulation(db, { now = new Date(), registeredTtlMs } = {}) {
  const day = dayKey(now);
  const [registered, arrivals] = await Promise.all([registeredAccounts(db, registeredTtlMs == null ? undefined : { ttlMs: registeredTtlMs }), arrivalsOn(db, day)]);
  return { people: populationOf({ registered, arrivals }), registered, arrivals, day, at: Date.now() };
}

/**
 * A real player entered the game. Counts it (and adds the random arrival) only when it is a genuine entry: the player has a character and has no counted entry
 * inside the cool-down. Everything happens in ONE transaction with two atomic statements:
 *   1. claim the entry:  INSERT ... ON CONFLICT DO UPDATE ... WHERE lastEntryAt <= cutoff.  Postgres locks the player's row, so two requests at the same moment
 *      (a retry, a second tab, a repeated call) cannot both win: the second one sees the first one's time and gets no row back.
 *   2. add the arrival:   INSERT ... ON CONFLICT (day) DO UPDATE SET arrivals = arrivals + n.  An increment done by the database, not read-then-write, so
 *      two different players entering at once both keep their numbers.
 * If step 2 fails, step 1 is rolled back with it: an entry is never "used up" without its arrival.
 * `draw` and `now` exist for tests; the server never takes either from a browser.
 * Returns { counted, added?, reason?, people, arrivals, registered, day, at }.
 */
export async function recordEntry(db, userId, { now = new Date(), draw = roll, cooldownMs = entryCooldownMs(), registeredTtlMs } = {}) {
  if (!userId || typeof userId !== "string") throw new TypeError("userId is required");
  const day = dayKey(now), cutoff = new Date(+now - cooldownMs);
  const out = await db.$transaction(async (tx) => {
    const has = await tx.$queryRaw`SELECT 1 AS ok FROM "Character" WHERE "userId" = ${userId} LIMIT 1`;
    if (!has.length) return { counted: false, reason: "no-character", arrivals: await arrivalsOn(tx, day) }; // an account that has not made a character has not entered the game
    const claimed = await tx.$queryRaw`INSERT INTO "CampusEntry" ("userId", "lastEntryAt") VALUES (${userId}, ${now})
      ON CONFLICT ("userId") DO UPDATE SET "lastEntryAt" = ${now} WHERE "CampusEntry"."lastEntryAt" <= ${cutoff}
      RETURNING 1 AS ok`;
    if (!claimed.length) return { counted: false, reason: "cooldown", arrivals: await arrivalsOn(tx, day) };
    const added = arrivalSize(draw);
    const [row] = await tx.$queryRaw`INSERT INTO "CampusArrivalDay" ("day", "arrivals", "entries", "updatedAt") VALUES (${day}, ${added}, 1, ${now})
      ON CONFLICT ("day") DO UPDATE SET "arrivals" = "CampusArrivalDay"."arrivals" + EXCLUDED."arrivals", "entries" = "CampusArrivalDay"."entries" + 1, "updatedAt" = EXCLUDED."updatedAt"
      RETURNING "arrivals"`;
    return { counted: true, added, arrivals: Number(row.arrivals) };
  });
  const registered = await registeredAccounts(db, registeredTtlMs == null ? undefined : { ttlMs: registeredTtlMs });
  return { ...out, registered, day, people: populationOf({ registered, arrivals: out.arrivals }), at: Date.now() };
}
