// tests/campus-population.test.mjs: the campus population rules (lib/campusPopulation.js) and its browser side (lib/populationFeed.js), without a database.
import assert from "node:assert/strict";
import { roll } from "../lib/rng.js";
import { BASE_POPULATION, ARRIVAL_MIN, ARRIVAL_MAX, ENTRY_COOLDOWN_MS, entryCooldownMs, dayKey, arrivalSize, populationOf, formatPeople, formatCount } from "../lib/campusPopulation.js";
import { createPopulationFeed, createEntryReporter, RETRY_MS } from "../lib/populationFeed.js";
import { getPopulation, recordEntry, isMissingTable } from "../lib/campusPopulationService.js";
const ok = (m) => console.log("OK  ", m);

// the arrival: always 11..22, whole, and both ends really happen
{
  const seen = new Set(); for (let i = 0; i < 4000; i++) { const n = arrivalSize(roll); assert.ok(Number.isInteger(n) && n >= 11 && n <= 22); seen.add(n); }
  assert.equal(seen.size, 12); assert.ok(seen.has(11) && seen.has(22)); assert.equal(ARRIVAL_MIN, 11); assert.equal(ARRIVAL_MAX, 22);
  assert.throws(() => arrivalSize(() => 23)); assert.throws(() => arrivalSize(() => 10)); assert.throws(() => arrivalSize(() => 14.5)); assert.throws(() => arrivalSize(() => NaN));
  ok("4000 draws: every value 11..22 appears, none outside; an out-of-range generator is refused, not trusted");
}
// the formula: base + registered + today's arrivals, nothing else, never negative
assert.equal(BASE_POPULATION, 5000); assert.equal(populationOf({ registered: 0, arrivals: 0 }), 5000);
assert.equal(populationOf({ registered: 1234, arrivals: 14 }), 6248); assert.equal(populationOf({ registered: -5, arrivals: "x" }), 5000); assert.equal(populationOf(), 5000);
assert.equal(formatPeople(6248), "6,248 people on campus"); assert.equal(formatCount(12345678), "12,345,678"); ok("5,000 + registered + arrivals, formatted as \"6,248 people on campus\"; bad input never makes it negative or NaN");
// the calendar day is West Africa Time (UTC+1): 23:30 UTC is already tomorrow in Lagos
assert.equal(dayKey(Date.UTC(2026, 10, 20, 22, 59, 59)), "2026-11-20"); assert.equal(dayKey(Date.UTC(2026, 10, 20, 23, 0, 0)), "2026-11-21");
assert.equal(dayKey(Date.UTC(2026, 11, 31, 23, 30)), "2027-01-01"); assert.equal(dayKey(Date.UTC(2026, 10, 20, 0, 0)), "2026-11-20"); ok("the day rolls over at midnight West Africa Time (23:00 UTC), including across a year end");
assert.equal(entryCooldownMs({}), ENTRY_COOLDOWN_MS); assert.equal(entryCooldownMs({ CAMPUS_ENTRY_COOLDOWN_MIN: "10" }), 600_000); assert.equal(entryCooldownMs({ CAMPUS_ENTRY_COOLDOWN_MIN: "0" }), ENTRY_COOLDOWN_MS); assert.equal(entryCooldownMs({ CAMPUS_ENTRY_COOLDOWN_MIN: "abc" }), ENTRY_COOLDOWN_MS);
ok("the entry cool-down is 30 minutes unless a sensible CAMPUS_ENTRY_COOLDOWN_MIN says otherwise");

// the feed: nothing until the server speaks; newest wins; push + reconnect refetch
{
  const handlers = new Set(), link = { on: (h) => { handlers.add(h); return () => handlers.delete(h); } }; let answer = { people: 6000, at: 100 }, loads = 0;
  const f = createPopulationFeed({ link, load: async () => { loads++; return answer; }, setTick: () => 1, clearTick: () => {} });
  assert.equal(f.people(), null, "no guess before the server has said");
  const stop = f.acquire(); await new Promise((r) => setTimeout(r, 10)); assert.equal(f.people(), 6000);
  for (const h of handlers) h.pop({ people: 6030, at: 200 }); assert.equal(f.people(), 6030);
  for (const h of handlers) h.pop({ people: 6010, at: 150 }); assert.equal(f.people(), 6030, "an older answer never wins");
  for (const h of handlers) h.pop({ people: "x", at: 300 }); for (const h of handlers) h.pop({ people: -1, at: 300 }); assert.equal(f.people(), 6030, "junk is ignored");
  answer = { people: 6100, at: 400 }; for (const h of handlers) h.connect(); await new Promise((r) => setTimeout(r, 10)); assert.equal(f.people(), 6100); assert.ok(loads >= 2);
  stop(); assert.equal(handlers.size, 0); ok("the feed shows nothing until told, takes the newest answer, ignores stale and junk ones, refetches after a reconnect, and detaches when unused");
}
// the entry reporter: once per visit, retried after a failure, never twice at once
{
  const mem = new Map(), store = { get: (k) => mem.get(k), set: (k, v) => mem.set(k, v) }; let posts = 0, fail = true;
  const r = createEntryReporter({ post: async () => { posts++; await new Promise((x) => setTimeout(x, 5)); return fail ? { failed: true } : { ok: true, people: 6014, at: 9 }; }, store });
  assert.deepEqual(await Promise.all([r("c1"), r("c1")]), ["retry", "skip"]); assert.equal(posts, 1, "two calls at once send one request (strict mode)");
  fail = false; assert.equal(await r("c1"), "sent"); assert.equal(await r("c1"), "skip"); assert.equal(await r("c1"), "skip"); assert.equal(posts, 2, "a failure is retried, a success is remembered: a refresh/navigation sends nothing");
  assert.equal(await r("c2"), "sent"); assert.equal(posts, 3); assert.equal(await r(""), "skip");
  const blocked = createEntryReporter({ post: async () => ({ ok: true }), store: { get() { throw new Error("denied"); }, set() { throw new Error("denied"); } } }); assert.equal(await blocked("c9"), "sent");
  ok("the entry is reported once per visit; a failed try is repeated; blocked storage cannot break it (the server's cool-down is the real guard)");
}
// a failed fetch is retried soon (the header must not stay empty until the next 2-minute poll), with a longer wait each time, and stops once there is a number
{
  const link = { on: () => () => {} }, timers = []; let fails = 3;
  const f = createPopulationFeed({ link, load: async () => (fails-- > 0 ? { failed: true } : { people: 5100, at: 5 }), setTick: () => 1, clearTick: () => {}, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
  f.acquire(); await new Promise((r) => setTimeout(r, 5)); assert.equal(f.people(), null); assert.equal(timers.length, 1); assert.equal(timers[0].ms, RETRY_MS[0]);
  timers[0].fn(); await new Promise((r) => setTimeout(r, 5)); assert.equal(timers[1].ms, RETRY_MS[1]);
  timers[1].fn(); await new Promise((r) => setTimeout(r, 5)); assert.equal(timers[2].ms, RETRY_MS[2]);
  timers[2].fn(); await new Promise((r) => setTimeout(r, 5)); assert.equal(f.people(), 5100); assert.equal(timers.length, 3, "no more retries once the number is there");
  ok("a failed fetch is retried after 3 s, 10 s, 30 s and then the number appears; no retries after that");
}
// the database does not have the campus tables yet (migration not applied): the header still answers instead of failing, and nothing is claimed as counted
{
  const missing = Object.assign(new Error('relation "CampusArrivalDay" does not exist'), { code: "42P01" });
  assert.ok(isMissingTable(missing) && isMissingTable({ code: "P2021" }) && isMissingTable({ meta: { code: "42P01" } }) && !isMissingTable(new Error("connection refused")));
  const db = { $queryRaw: async (st) => { if (st.join("?").includes("CampusArrivalDay")) throw missing; return [{ n: 7 }]; }, $transaction: async () => { throw missing; } };
  const origErr = console.error; console.error = () => {};
  try {
    const p = await getPopulation(db, { registeredTtlMs: 0 }); assert.equal(p.people, 5007); assert.equal(p.arrivals, 0);
    const r = await recordEntry(db, "u1", { registeredTtlMs: 0 }); assert.equal(r.counted, false); assert.equal(r.reason, "not-migrated"); assert.equal(r.people, 5007);
    await assert.rejects(getPopulation({ $queryRaw: async () => { throw new Error("connection refused"); } }, { registeredTtlMs: 0 }), /connection refused/); // real errors are still errors
  } finally { console.error = origErr; }
  ok("without the migration the header still shows 5,000 + registered accounts and nothing is counted; other database errors still surface");
}
console.log("DONE");
