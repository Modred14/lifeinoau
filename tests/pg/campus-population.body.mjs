// tests/pg/campus-population.body.mjs: the checks for the campus population against a REAL PostgreSQL database with every migration applied. Shared by
// tests/pg/campus-population.pg.mjs (the repo's harness, the normal way to run it) and by any runner that can hand over { db, reset, player }.
// Only db.$queryRaw / $executeRaw / $transaction are used here, the same calls the service itself makes.
import assert from "node:assert/strict";
import { recordEntry, getPopulation, registeredAccounts } from "../../lib/campusPopulationService.js";
import { dayKey } from "../../lib/campusPopulation.js";

export async function run({ db, reset, player, ok }) {
  const H = 3_600_000, T0 = new Date(Date.UTC(2026, 10, 20, 10, 0, 0)); // 11:00 on 20 Nov 2026 in Lagos
  const fresh = { registeredTtlMs: 0 };
  const day = async (d) => (await db.$queryRaw`SELECT "arrivals", "entries" FROM "CampusArrivalDay" WHERE "day" = ${d}`)[0] ?? { arrivals: 0, entries: 0 };
  const total = async () => Number((await db.$queryRaw`SELECT COALESCE(SUM("arrivals"),0)::int AS n FROM "CampusArrivalDay"`)[0].n);

  await reset();
  // 1. a new player enters: +11..22, counted once, and the header number is base + registered + arrivals
  const ada = await player("Ada"), before = await db.$queryRaw`SELECT "loginCount", "lastActiveAt", "lastLoginAt" FROM "User" WHERE "id" = ${ada.uid}`;
  assert.equal((await getPopulation(db, { now: T0, ...fresh })).people, 5000 + 1); // one registered account, nobody has entered yet today
  const r1 = await recordEntry(db, ada.uid, { now: T0, ...fresh });
  assert.equal(r1.counted, true); assert.ok(r1.added >= 11 && r1.added <= 22, "arrival " + r1.added); assert.equal(r1.arrivals, r1.added);
  assert.equal(r1.people, 5000 + 1 + r1.added); assert.equal(r1.day, "2026-11-20"); assert.deepEqual(await day("2026-11-20"), { arrivals: r1.added, entries: 1 });
  ok("a new player enters: the day's arrivals grow by 11..22 and people = 5000 + registered + arrivals", `(+${r1.added} -> ${r1.people})`);
  assert.deepEqual(await db.$queryRaw`SELECT "loginCount", "lastActiveAt", "lastLoginAt" FROM "User" WHERE "id" = ${ada.uid}`, before);
  ok("the real account's analytics fields (loginCount, lastActiveAt, lastLoginAt) are untouched by a simulated arrival");

  // 2. the same player again: refresh, retry, second tab, repeated request: nothing, until the cool-down has passed
  for (const [label, at] of [["immediately", T0], ["10 minutes later", new Date(+T0 + 10 * 60_000)], ["29 minutes later", new Date(+T0 + 29 * 60_000)]]) {
    const r = await recordEntry(db, ada.uid, { now: at, ...fresh }); assert.equal(r.counted, false, label); assert.equal(r.reason, "cooldown"); assert.equal(r.arrivals, r1.added);
  }
  assert.deepEqual(await day("2026-11-20"), { arrivals: r1.added, entries: 1 }); ok("the same player again (immediately, 10 and 29 minutes later): no new arrival");
  const dup = await Promise.all(Array.from({ length: 30 }, () => recordEntry(db, ada.uid, { now: new Date(+T0 + 31 * 60_000), ...fresh })));
  assert.equal(dup.filter((x) => x.counted).length, 1, "30 identical simultaneous requests after the cool-down count exactly once");
  const second = dup.find((x) => x.counted); assert.deepEqual(await day("2026-11-20"), { arrivals: r1.added + second.added, entries: 2 });
  ok("after the cool-down a genuine new entry counts, and 30 identical requests at the same moment still add exactly one arrival");

  // 3. different players at the same moment: every increment is kept
  await reset(); const crowd = []; for (let i = 0; i < 40; i++) crowd.push(await player("P" + i));
  const outs = await Promise.all(crowd.map((p) => recordEntry(db, p.uid, { now: T0, ...fresh })));
  assert.ok(outs.every((x) => x.counted)); const sum = outs.reduce((a, x) => a + x.added, 0);
  assert.deepEqual(await day("2026-11-20"), { arrivals: sum, entries: 40 }); assert.equal(await total(), sum);
  assert.equal((await getPopulation(db, { now: T0, ...fresh })).people, 5000 + 40 + sum); ok("40 different players entering at the same moment: all 40 increments are kept (sum " + sum + "), none overwritten");

  // no double counting of people: registered accounts are counted once; online/active players are not added again
  assert.equal(await registeredAccounts(db, { ttlMs: 0 }), 40);
  await db.$executeRaw`UPDATE "User" SET "lastActiveAt" = now()`; assert.equal(await registeredAccounts(db, { ttlMs: 0 }), 40); assert.equal((await getPopulation(db, { now: T0, ...fresh })).people, 5040 + sum);
  await db.$executeRaw`UPDATE "User" SET "status" = 'DELETED' WHERE "id" = ${crowd[0].uid}`; assert.equal(await registeredAccounts(db, { ttlMs: 0 }), 39); ok("registered accounts are counted once (active players are not added on top); archived accounts are not counted");

  // an account with no character has not entered the game; a failed arrival does not use up the entry
  await reset(); const noChar = await db.$queryRaw`INSERT INTO "User" ("id","email","passwordHash","isAdult") VALUES ('u_nochar','n@test.local','x',true) RETURNING "id"`;
  const rn = await recordEntry(db, noChar[0].id, { now: T0, ...fresh }); assert.equal(rn.counted, false); assert.equal(rn.reason, "no-character"); assert.equal(await total(), 0);
  const eve = await player("Eve"); await assert.rejects(recordEntry(db, eve.uid, { now: T0, draw: () => 99, ...fresh }));
  assert.equal((await db.$queryRaw`SELECT count(*)::int AS n FROM "CampusEntry"`)[0].n, 0, "the failed attempt was rolled back: no entry was used up");
  assert.equal((await recordEntry(db, eve.uid, { now: T0, ...fresh })).counted, true); ok("no character -> not counted; an error while adding rolls the entry back so a retry still counts");

  // 10. a new calendar day (West Africa Time) starts again from zero, without touching anything real or the old day
  await reset(); const bo = await player("Bo"), cy = await player("Cy");
  const late = new Date(Date.UTC(2026, 10, 20, 22, 45)), after = new Date(Date.UTC(2026, 10, 20, 23, 5)); // 23:45 and 00:05 in Lagos
  assert.equal(dayKey(late), "2026-11-20"); assert.equal(dayKey(after), "2026-11-21");
  const d1 = await recordEntry(db, bo.uid, { now: late, ...fresh }), d2 = await recordEntry(db, cy.uid, { now: after, ...fresh });
  assert.equal(d1.arrivals, d1.added); assert.equal(d2.arrivals, d2.added, "the new day starts again from its own first arrival"); assert.equal(d2.day, "2026-11-21");
  assert.deepEqual(await day("2026-11-20"), { arrivals: d1.added, entries: 1 }); assert.deepEqual(await day("2026-11-21"), { arrivals: d2.added, entries: 1 });
  assert.equal((await getPopulation(db, { now: after, ...fresh })).people, 5000 + 2 + d2.added); assert.equal((await getPopulation(db, { now: late, ...fresh })).people, 5000 + 2 + d1.added);
  assert.equal((await db.$queryRaw`SELECT count(*)::int AS n FROM "User"`)[0].n, 2); ok("at midnight West Africa Time the day's arrivals start again from 0; the old day and the registered accounts are untouched");
  // the same player entering after midnight, 20 minutes after their entry before it, is still inside the cool-down: the cool-down is about the player, not the day
  const bo2 = await recordEntry(db, bo.uid, { now: after, ...fresh }); assert.equal(bo2.counted, false); ok("a player who entered 15 minutes before midnight and again at 00:05 is not counted twice (the cool-down belongs to the player)");
}
