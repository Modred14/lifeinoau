// tests/campus-population.test.mjs: the campus population rules (lib/campusPopulation.js) and its browser side (lib/populationFeed.js), without a database.
import assert from "node:assert/strict";
import { roll } from "../lib/rng.js";
import { BASE_POPULATION, ARRIVAL_MIN, ARRIVAL_MAX, ENTRY_COOLDOWN_MS, entryCooldownMs, dayKey, arrivalSize, populationOf, formatPeople, formatCount } from "../lib/campusPopulation.js";
import { createPopulationFeed, createEntryReporter } from "../lib/populationFeed.js";
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
assert.equal(formatPeople(6248), "6,248 people visited today"); assert.equal(formatCount(12345678), "12,345,678"); ok("5,000 + registered + arrivals, formatted as \"6,248 people visited today\"; bad input never makes it negative or NaN");
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
console.log("DONE");
