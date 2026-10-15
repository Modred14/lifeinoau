// tests/bet.test.mjs
// The Bet app maths: fixtures are stable, odds carry a margin, results follow the odds, Aviator and roulette have their real edge.
import assert from "node:assert/strict";
process.env.BET_SECRET = "test-secret";
const { fixturesOf, parseId, roundOf, kickoffOf, minuteAt, phaseAt, MATCH_MS, CYCLE_MS } = await import("../lib/bet/fixtures.js");
const { oddsFor, allOdds, pickWins, payoutOf, totalOddsX, MARKETS } = await import("../lib/bet/markets.js");
const { resultOf, liveOf } = await import("../lib/bet/results.js");
const av = await import("../lib/bet/aviatorMath.js");
const rl = await import("../lib/bet/rouletteMath.js");

// 1. fixtures: eight a round, every team once, same every time, parseable
{
  const a = fixturesOf(1234), b = fixturesOf(1234);
  assert.equal(a.length, 8); assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  const names = a.flatMap((x) => [x.home, x.away]); assert.equal(new Set(names).size, 16, "no team plays twice in a round");
  for (const f of a) { assert.equal(parseId(f.id).home, f.home); assert.equal(f.ko, kickoffOf(1234)); }
  assert.equal(parseId("nonsense"), null); assert.equal(parseId("5-9"), null);
  assert.equal(roundOf(kickoffOf(77) + CYCLE_MS - 1), 77);
  console.log("OK   fixtures are stable and well formed");
}

// 2. odds: a bookmaker's margin on every market, and never below 1.05
{
  let min = 1e9;
  for (let r = 0; r < 200; r++) for (const f of fixturesOf(r)) {
    const o = allOdds(f);
    for (const mk of Object.keys(MARKETS)) for (const v of Object.values(o[mk])) { assert.ok(Number.isInteger(v) && v >= 105); min = Math.min(min, v); }
    const book = 100 / o["1x2"].h + 100 / o["1x2"].d + 100 / o["1x2"].a;
    assert.ok(book > 1.0 && book < 1.16, `1x2 overround ${book}`);
    const ou = 100 / o.ou25.o + 100 / o.ou25.u; assert.ok(ou > 1.0 && ou < 1.12, `ou overround ${ou}`);
  }
  console.log("OK   odds carry a margin, shortest price", (min / 100).toFixed(2));
}

// 3. results: deterministic, goals add up, and a punter who backs every home win gets back about what the odds promise
{
  const r1 = resultOf("100-3"), r2 = resultOf("100-3"); assert.deepEqual(r1, r2);
  assert.equal(r1.goals.length, r1.h + r1.a);
  let staked = 0, back = 0, overs = 0, n = 0;
  for (let r = 0; r < 2500; r++) for (let i = 0; i < 8; i++) {
    const f = fixturesOf(r)[i], res = resultOf(f.id);
    staked++; if (pickWins("1x2", "h", res.h, res.a)) back += oddsFor(f, "1x2", "h") / 100;
    if (pickWins("ou25", "o", res.h, res.a)) overs++; n++;
  }
  const rtp = back / staked; assert.ok(rtp > 0.88 && rtp < 0.98, `backing every home win returned ${rtp}`);
  assert.ok(overs / n > 0.3 && overs / n < 0.7, "over 2.5 happens a sensible share of the time");
  console.log("OK   results follow the odds: home-win return", rtp.toFixed(3));
}

// 4. live view: goals only appear when their minute passes, full time shows them all
{
  const f = fixturesOf(500).find((x) => resultOf(x.id).goals.length >= 2), res = resultOf(f.id);
  assert.equal(liveOf(f.id, f.ko - 1000).ph, "pre");
  const first = res.goals[0], t = f.ko + (first.m - 1) * (MATCH_MS / 90);
  const early = liveOf(f.id, t); assert.equal(early.h + early.a, res.goals.filter((g) => g.m <= early.m).length);
  const ft = liveOf(f.id, f.ko + MATCH_MS + 1); assert.equal(ft.ph, "ft"); assert.equal(ft.h, res.h); assert.equal(ft.a, res.a);
  assert.equal(minuteAt(f.ko, f.ko + MATCH_MS * 5), 90); assert.equal(phaseAt(f.ko, f.ko + 1), "live");
  console.log("OK   live score reveals goals minute by minute");
}

// 5. slip maths is exact
{
  const legs = [{ odds: 185 }, { odds: 210 }, { odds: 150 }];
  assert.equal(totalOddsX(legs), 5.82);
  assert.equal(payoutOf(1_000_00n, legs), 5_820_00n, "paid on the odds as shown (5.82)");
  assert.equal(payoutOf(500_000_00n, Array(12).fill({ odds: 500 })), 20_000_000_00n, "win cap");
  console.log("OK   slip payout is exact and capped");
}

// 6. aviator: the curve, the crash law and the house edge
{
  assert.equal(av.centiAt(0), 100); assert.ok(av.centiAt(10.7) >= 199 && av.centiAt(10.7) <= 201);
  for (const c of [150, 200, 1000, 5000]) assert.ok(Math.abs(av.centiAt(av.secAt(c)) - c) <= 1);
  assert.equal(av.crashFromUniform(0.0), 100); assert.equal(av.crashFromUniform(0.02), 100);
  const N = 400_000; let instant = 0, under2 = 0, ret2 = 0, ret10 = 0;
  for (let i = 0; i < N; i++) {
    const c = av.crashFromUniform(Math.random());
    if (c === 100) instant++; if (c < 200) under2++; if (c >= 200) ret2 += 2; if (c >= 1000) ret10 += 10;
  }
  assert.ok(Math.abs(instant / N - 0.04) < 0.006, "about 4% of flights show 1.00x (3% instant plus rounding)");
  assert.ok(Math.abs(under2 / N - 0.515) < 0.01, "about half fly away before 2x");
  assert.ok(Math.abs(ret2 / N - 0.97) < 0.02 && Math.abs(ret10 / N - 0.97) < 0.04, "every cash-out target returns about 97%");
  assert.equal(av.payout(1_000_00n, 250), 2_500_00n);
  assert.ok(av.capCenti(100_000_00n) >= 100 && av.capCenti(100n) === av.MAX_CRASH * 100);
  console.log("OK   aviator: 97% return, ~4% show 1.00x, half gone before 2x");
}

// 7. roulette: what a bet covers, what is illegal, and the 2.70% edge on every bet
{
  assert.deepEqual(rl.coverage({ type: "straight", ref: 17 }), { nums: [17], pays: 35 });
  assert.ok(rl.coverage({ type: "split", ref: "1-2" }) && rl.coverage({ type: "split", ref: "1-4" }) && rl.coverage({ type: "split", ref: "0-3" }));
  assert.equal(rl.coverage({ type: "split", ref: "3-4" }), null, "3 and 4 do not touch");
  assert.equal(rl.coverage({ type: "split", ref: "1-5" }), null);
  assert.deepEqual(rl.coverage({ type: "street", ref: 4 }).nums, [4, 5, 6]); assert.equal(rl.coverage({ type: "street", ref: 5 }), null);
  assert.deepEqual(rl.coverage({ type: "corner", ref: 1 }).nums, [1, 2, 4, 5]); assert.equal(rl.coverage({ type: "corner", ref: 3 }), null);
  assert.equal(rl.coverage({ type: "column", ref: 2 }).nums.length, 12); assert.equal(rl.coverage({ type: "dozen", ref: 3 }).nums[0], 25);
  assert.equal(rl.coverage({ type: "even", ref: "red" }).nums.length, 18); assert.equal(rl.coverage({ type: "even", ref: "bogus" }), null);
  assert.equal(rl.coverage({ type: "straight", ref: 37 }), null); assert.equal(rl.coverage({ type: "nope", ref: 1 }), null);
  const sample = [["straight", 0], ["straight", 8], ["split", "8-9"], ["split", "0-1"], ["street", 7], ["corner", 11], ["column", 1], ["dozen", 2], ["even", "black"], ["even", "low"], ["trio", "0-2-3"]];
  for (const [type, ref] of sample) {
    const c = rl.coverage({ type, ref }); assert.ok(c, type); let back = 0n;
    for (let n = 0; n <= 36; n++) back += rl.settle([{ type, ref, chip: 100n }], n).paid;
    assert.equal(back, 36n * 100n, `${type} ${ref}: 36 of 37 chips come back over a full wheel`);
  }
  const r = rl.settle([{ type: "straight", ref: 7, chip: 100n }, { type: "even", ref: "red", chip: 200n }], 7);
  assert.equal(r.staked, 300n); assert.equal(r.paid, 3600n + 400n);
  assert.equal(rl.WHEEL.length, 37); assert.equal(new Set(rl.WHEEL).size, 37);
  console.log("OK   roulette: coverage rules and a 36/37 return on every bet");
}
