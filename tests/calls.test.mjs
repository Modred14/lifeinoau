// tests/calls.test.mjs: the Calls app's pure rules (lib/callRules.js). The dice are passed in, so every outcome can be forced. No database.
import assert from "node:assert/strict";
import { PARENT_CALL, PLAYER_CALL, parentName, parentWeights, pickOutcome, resolveParentCall, parentCooldownLeft, parentStatusOf, isAnsweredOutcome, waitLabel, allowanceFor, isOnline, expiryOf, dialBlock, askBlock } from "../lib/callRules.js";
import { FEATURES } from "../lib/features.js";

const ALLOW = allowanceFor("MAPO"); // ₦100,000
assert.equal(ALLOW, 10_000_000n);
const sum = (w) => Object.values(w).reduce((a, b) => a + b, 0);

// the parent: stable identity, honest odds
assert.equal(parentName("abc"), parentName("abc")); assert.ok(["Mummy", "Daddy"].includes(parentName("zzz")));
assert.equal(sum(PARENT_CALL.weights), 100);
const base = parentWeights({ balance: 0n, allowance: ALLOW, missedStreak: 0 });
assert.deepEqual(base, PARENT_CALL.weights); assert.notEqual(base, PARENT_CALL.weights, "a copy: the constants are never changed");
const upset = parentWeights({ balance: 0n, allowance: ALLOW, missedStreak: 2 });
assert.equal(upset.GIVEN, 35); assert.equal(upset.REFUSED, 25); assert.equal(sum(upset), 100);
assert.equal(parentWeights({ balance: 0n, allowance: ALLOW, missedStreak: 99 }).GIVEN, 30, "capped");
const rich = parentWeights({ balance: ALLOW * 4n, allowance: ALLOW, missedStreak: 0 });
assert.ok(rich.GIVEN < base.GIVEN && sum(rich) === 100, "a player holding weeks of allowance is told they do not need it");
assert.equal(parentWeights({ balance: ALLOW * 3n, allowance: ALLOW }).GIVEN, base.GIVEN, "exactly three weeks is not rich yet");
// the dice land where the weights say, across the whole range
const seen = new Map(); for (let r = 0; r < 100; r++) seen.set(pickOutcome(base, r), (seen.get(pickOutcome(base, r)) ?? 0) + 1);
assert.deepEqual(Object.fromEntries(seen), PARENT_CALL.weights);

// every outcome, forced
const dice = (...v) => { let i = 0; return (lo, hi) => Math.min(hi, Math.max(lo, v[i++ % v.length])); };
const at = (r, ...rest) => resolveParentCall({ allowance: ALLOW, balance: 0n, missedStreak: 0, givenThisWeek: 0n, roll: dice(r, ...rest) });
assert.equal(at(0).outcome, "NO_ANSWER"); assert.equal(at(10).outcome, "CALL_DECLINED"); assert.equal(at(15).outcome, "REFUSED"); assert.equal(at(30).outcome, "LATER"); assert.equal(at(55).outcome, "GIVEN");
for (const o of ["NO_ANSWER", "CALL_DECLINED", "REFUSED", "LATER"]) { const r = at({ NO_ANSWER: 0, CALL_DECLINED: 10, REFUSED: 15, LATER: 30 }[o]); assert.equal(r.giftKobo, 0n); assert.ok(r.line.length > 5); }
assert.equal(at(55, 5).giftKobo, 500_000n, "5% of ₦100,000 = ₦5,000"); assert.equal(at(55, 20).giftKobo, 2_000_000n, "20% = ₦20,000"); assert.equal(at(55, 13).giftKobo, 1_300_000n);
for (let pct = 5; pct <= 20; pct++) assert.equal(at(55, pct).giftKobo % 10_000n, 0n, "a whole ₦100 multiple");
assert.deepEqual([at(55).happiness, at(30).happiness, at(15).happiness, at(0).happiness], [3, 1, -1, 0]);
// the weekly cap: 60% of the allowance, counting gifts from every road
const cap = (ALLOW * 60n) / 100n;
assert.equal(resolveParentCall({ allowance: ALLOW, givenThisWeek: cap - 1_000_000n, roll: dice(55, 20) }).giftKobo, 1_000_000n, "a gift is trimmed to what is left of the week's cap");
const spent = resolveParentCall({ allowance: ALLOW, givenThisWeek: cap, roll: dice(55, 20, 0) });
assert.equal(spent.outcome, "LATER"); assert.equal(spent.giftKobo, 0n); assert.match(spent.line, /already sent you a lot this week/);
assert.equal(resolveParentCall({ allowance: ALLOW, givenThisWeek: cap - 100_000n, roll: dice(55, 5, 0) }).outcome, "LATER", "less than the smallest gift left: no gift");
// what an outcome means for the call record
assert.deepEqual(["NO_ANSWER", "CALL_DECLINED", "REFUSED", "LATER", "GIVEN"].map(parentStatusOf), ["MISSED", "DECLINED", "ENDED", "ENDED", "ENDED"]);
assert.deepEqual(["NO_ANSWER", "CALL_DECLINED", "REFUSED", "LATER", "GIVEN"].map(isAnsweredOutcome), [false, false, true, true, true]);

// cooldowns after a call home
const T = Date.now(), min = 60_000;
assert.equal(parentCooldownLeft(null, T), 0);
assert.equal(parentCooldownLeft({ createdAt: new Date(T - 4 * min), outcome: "NO_ANSWER" }, T), 6 * min);
assert.equal(parentCooldownLeft({ createdAt: new Date(T - 11 * min), outcome: "NO_ANSWER" }, T), 0);
assert.ok(parentCooldownLeft({ createdAt: new Date(T - 60 * min), outcome: "GIVEN" }, T) > parentCooldownLeft({ createdAt: new Date(T - 60 * min), outcome: "LATER" }, T), "a gift buys a longer wait than 'try later'");
assert.deepEqual([0, 1, 59_001, 3_600_000, 3_660_000, 7_500_000].map(waitLabel), ["0s", "1s", "1m", "1h", "1h 1m", "2h 5m"]);

// presence
assert.equal(isOnline(new Date(T - 10_000), T), true); assert.equal(isOnline(new Date(T - 30_000), T), false); assert.equal(isOnline(null, T), false);

// a call that runs out of time settles itself, to the right ending, at the right moment
const call = (o) => ({ status: "RINGING", askStatus: "NONE", ringUntil: new Date(T + 5_000), idleUntil: null, askUntil: null, ...o });
assert.equal(expiryOf(call(), T), null, "still ringing");
assert.deepEqual(expiryOf(call({ ringUntil: new Date(T - 1) }), T), { status: "MISSED", endReason: "NO_ANSWER", at: T - 1 });
assert.equal(expiryOf(call({ status: "ANSWERED", idleUntil: new Date(T + 1000) }), T), null);
assert.equal(expiryOf(call({ status: "ANSWERED", idleUntil: new Date(T - 1) }), T).endReason, "TIMEOUT");
const ask = expiryOf(call({ status: "ANSWERED", askStatus: "PENDING", askUntil: new Date(T - 1) }), T); assert.deepEqual([ask.status, ask.askStatus, ask.endReason], ["ENDED", "EXPIRED", "NO_RESPONSE"]);
assert.equal(expiryOf(call({ status: "ANSWERED", askStatus: "PENDING", askUntil: new Date(T + 1000), idleUntil: new Date(T - 1) }), T), null, "a pending question is not cut by the idle timer");
for (const done of ["ENDED", "MISSED", "DECLINED", "CANCELLED"]) assert.equal(expiryOf(call({ status: done, ringUntil: new Date(0) }), T), null, `${done} is final`);

// dialling limits
assert.equal(dialBlock({}, T), null);
assert.match(dialBlock({ callsLastHour: PLAYER_CALL.callsPerHour }, T), /break/);
assert.match(dialBlock({ lastToPeer: { status: "MISSED", createdAt: new Date(T - 10_000), endedAt: new Date(T - 5_000) }, peerName: "Ben" }, T), /just tried Ben/);
assert.equal(dialBlock({ lastToPeer: { status: "MISSED", createdAt: new Date(T - 90_000), endedAt: new Date(T - 80_000) } }, T), null);
assert.match(dialBlock({ lastToPeer: { status: "DECLINED", createdAt: new Date(T - 60_000), endedAt: new Date(T - 50_000) }, peerName: "Ben" }, T), /not taking your calls right now/);
assert.match(dialBlock({ lastToPeer: { status: "ENDED", askStatus: "REJECTED", createdAt: new Date(T - 600_000), endedAt: new Date(T - 590_000) }, peerName: "Ben" }, T), /Try again in/);
assert.equal(dialBlock({ lastToPeer: { status: "ENDED", askStatus: "APPROVED", createdAt: new Date(T - 1000), endedAt: new Date(T - 500) } }, T), null, "a call that went well can be repeated");
assert.equal(askBlock({}), null); assert.match(askBlock({ asksToday: PLAYER_CALL.asksPerDay }), /today/); assert.match(askBlock({ asksToPeerToday: PLAYER_CALL.asksPerPairPerDay }), /this player/);
// player requests use exactly the limits of a normal transfer
assert.deepEqual([PLAYER_CALL.askMinNaira, PLAYER_CALL.askMaxNaira], [100, 5_000_000]);

// the Guide describes the Calls app from these same numbers
const g = FEATURES.find((f) => f.id === "money.calls"); assert.ok(g && g.api.includes("/api/calls"));
assert.ok(g.costs.join(" ").includes(`${PARENT_CALL.maxCallsPerWeek} calls a week`) && g.costs.join(" ").includes(`${PARENT_CALL.weeklyGiftCapPct}%`));
console.log("calls rules: ok");
