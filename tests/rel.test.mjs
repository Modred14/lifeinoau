import assert from "node:assert/strict";
import * as R from "../lib/relationships.js";

assert.deepEqual(R.pairIds("z", "a"), ["a", "z"]);
assert.deepEqual(R.pairIds("a", "z"), ["a", "z"]);
const bond = { lowId: "a", highId: "z", kind: "TALKING", affection: 50, dates: 0, meals: 0, visits: 0, kindWeek: 5, lastWeek: 5, done: {} };
const ctx = { me: "a", week: 6, energy: 80, myGender: "M", theirGender: "F", offCampus: true, hasBabe: false, theyHaveBabe: false, mySneaky: 0, theirSneaky: 0, together: false };
assert.equal(R.otherOf(bond, "a"), "z");
assert.equal(R.otherOf(bond, "z"), "a");
for (const a of ["M", "F"]) for (const b of ["M", "F"]) assert.equal(R.startKind(a, b), a === b ? "BESTIE" : "TALKING");
for (const week of [4, 5, 6]) assert.equal(R.decayFor(5, week), 0);
assert.equal(R.decayFor(5, 9), 9);
assert.equal(R.decayFor(5, 9, true), 3);
assert.equal(R.affectionNow(bond, 9), 41);
assert.equal(R.affectionNow(bond, 9, true), 47);
assert.equal(R.affectionNow(bond, 100), 0);
assert.equal(R.affectionNow({ ...bond, affection: 120 }, 5), 100);
assert.equal(R.moodOf(79), "Smitten");
assert.equal(R.moodOf(80), "Inseparable");

const ready = { ...bond, ...R.NEED };
assert.equal(R.progress(bond).ready, false);
assert.equal(R.progress(ready).ready, true);
for (const key of Object.keys(R.NEED)) {
  assert.equal(R.progress({ ...ready, [key]: R.NEED[key] - 1 }).ready, false, key);
  assert(R.whyNotAsk({ ...ready, [key]: R.NEED[key] - 1 }, "BABE", ctx), key);
}
assert.deepEqual(R.progress({ ...ready, dates: 100 }).items.map((i) => i.have), Object.values(R.NEED));
for (const kind of ["BABE", "SNEAKY"]) {
  assert.equal(R.whyNotAsk(ready, kind, ctx), null);
  assert(R.whyNotAsk(ready, kind, { ...ctx, theirGender: "M" }));
  assert(R.whyNotAsk({ ...ready, kind: "BESTIE" }, kind, ctx));
  assert(R.whyNotAsk({ ...ready, kind: "BABE" }, kind, ctx));
  assert(R.whyNotAsk({ ...ready, cheatedBy: "a" }, kind, ctx));
}
for (const key of ["hasBabe", "theyHaveBabe"]) {
  assert(R.whyNotAsk(ready, "BABE", { ...ctx, [key]: true }));
  assert.equal(R.whyNotAsk(ready, "SNEAKY", { ...ctx, [key]: true }), null);
}
for (const key of ["mySneaky", "theirSneaky"]) {
  assert.equal(R.whyNotAsk(ready, "SNEAKY", { ...ctx, [key]: R.MAX_SNEAKY - 1 }), null);
  assert(R.whyNotAsk(ready, "SNEAKY", { ...ctx, [key]: R.MAX_SNEAKY }));
}
const babe = { ...ready, kind: "BABE" };
assert(R.whyNotAsk(babe, "PROPOSE", { ...ctx, week: 5 }));
assert.equal(R.whyNotAsk(babe, "PROPOSE", { ...ctx, week: 5 + R.PROPOSE_AFTER_WEEKS }), null);
assert(R.whyNotAsk(ready, "PROPOSE", ctx));
assert(R.whyNotAsk({ ...babe, kind: "ENGAGED" }, "PROPOSE", ctx));
assert(R.whyNotAsk(babe, "MOVEIN", { ...ctx, offCampus: false }));
assert(R.whyNotAsk(babe, "MOVEIN", { ...ctx, together: true }));
assert.equal(R.whyNotAsk(babe, "MOVEIN", ctx), null);
const ex = { ...babe, kind: "EX", prevKind: "BABE", endedWeek: 5 };
assert.equal(R.whyNotAsk(ex, "RECONCILE", { ...ctx, week: 5 + R.RECONCILE_WEEKS }), null);
assert(R.whyNotAsk(ex, "RECONCILE", { ...ctx, week: 6 + R.RECONCILE_WEEKS }));
assert(R.whyNotAsk(ex, "RECONCILE", { ...ctx, theyHaveBabe: true }));
assert(R.whyNotAsk(babe, "RECONCILE", ctx));
assert(R.whyNotAsk(bond, "unknown", ctx));

for (const [activity, spec] of Object.entries(R.ACTIVITY)) {
  for (const kind of R.KINDS) {
    assert.equal(R.whyNotActivity({ ...bond, kind }, activity, ctx) === null, spec.kinds.includes(kind), `${kind}/${activity}`);
  }
  const allowed = { ...bond, kind: spec.kinds[0] };
  const key = R.limitKey(activity, ctx.me);
  assert.equal(R.doneThisWeek({ ...allowed, done: { [key]: 6 } }, activity, ctx.me, 6), true);
  assert(R.whyNotActivity({ ...allowed, done: { [key]: 6 } }, activity, ctx));
  assert.equal(R.whyNotActivity({ ...allowed, done: { [key]: 5 } }, activity, ctx), null);
  if (spec.limit === "player") assert.equal(R.whyNotActivity({ ...allowed, done: { [R.limitKey(activity, "z")]: 6 } }, activity, ctx), null);
  if (spec.energy) {
    assert(R.whyNotActivity(allowed, activity, { ...ctx, energy: spec.energy - 1 }));
    assert.equal(R.whyNotActivity(allowed, activity, { ...ctx, energy: spec.energy }), null);
  }
  for (const cheatedBy of ["a", "z"]) assert.equal(R.whyNotActivity({ ...allowed, cheatedBy }, activity, ctx) === null, spec.solo);
}
assert(R.whyNotActivity(bond, "unknown", ctx));
assert.equal(R.whyNotInvite(bond, "DATE", ctx), R.whyNotActivity(bond, "date", ctx));
for (const [tier, [cost, aff]] of Object.entries(R.GIFTS)) {
  const gift = R.outcome("gift", { tier });
  assert.equal(gift.costKobo, BigInt(cost) * 100n);
  assert.equal(gift.aff, aff);
}
assert(R.outcome("gift", { tier: "missing" }).error);
for (const [tier, [cost, aff]] of Object.entries(R.RINGS)) assert.deepEqual(R.ringOf(tier), { costNaira: cost, costKobo: BigInt(cost) * 100n, aff });
assert.equal(R.ringOf("missing"), null);
assert.equal(R.outcome("night", { variant: "safe" }).costKobo, BigInt(R.COST.safe) * 100n);
assert.equal(R.outcome("night", { variant: "risky" }).costKobo, 0n);
assert.deepEqual(R.PREGNANCY_RISK, { risky: 6, safe: 1 });
assert.equal(R.outcome("date").counts, "dates");
assert.equal(R.outcome("food").counts, "meals");
assert.equal(R.outcome("visit").counts, "visits");
assert.equal(R.catchChance("hang"), 0);
assert(R.catchChance("date", { together: true }) > R.catchChance("date"));
assert(R.catchChance("date", { sameHall: true }) > R.catchChance("date"));
assert.equal(R.catchChance("note", { luck: 100, popularity: 0 }), 3);
assert.equal(R.catchChance("night", { luck: 0, popularity: 1000, together: true, sameHall: true }), 70);
console.log("Player relationship rules, progression boundaries, activity limits, costs and risks passed");
