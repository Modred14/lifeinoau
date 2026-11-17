// tests/aviator-sync.test.mjs: the plane on screen and the server's crash point can never disagree.
// Real service code on the in-memory fake database, real shared curve, real client flight logic (lib/bet/aviatorSync.js, the same module the screen uses).
import assert from "node:assert/strict";
process.env.BET_SECRET = "test-secret";
const { makeDb } = await import("./fakedb.mjs");
const av = await import("../lib/bet/aviatorMath.js");
const sync = await import("../lib/bet/aviatorSync.js");
const A = await import("../lib/bet/aviatorService.js");
const N = (n) => BigInt(n) * 100n, MIN = 60_000;

const models = ["character", "account", "actionLog", "ledgerEntry", "floorZero", "gameClock", "notification", "achievement", "examResult", "partyTicket", "bond", "business", "casinoRound", "betSlip"];
const db = makeDb(models, { defaults: { notification: { readAt: null }, casinoRound: { status: "FLYING", crashCenti: 0, payoutKobo: 0n, settledAt: null, cashCenti: null, autoCenti: null, data: null }, betSlip: { status: "OPEN", payoutKobo: 0n, settledAt: null, createdAt: new Date(0) } }, unique: { actionLog: ["characterId", "requestId"], ledgerEntry: ["idempotencyKey"] }, join: { character: (r, T) => ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: { name: "Tech", difficulty: 1 } }) } });
const T = db.T();
{ const raw = db.$transaction; let tail = Promise.resolve(); db.$transaction = (fn) => { const p = tail.then(() => raw(fn)); tail = p.catch(() => {}); return p; }; }
let clock = Date.UTC(2026, 9, 20, 12, 0, 0); Date.now = () => clock;
T.account.push({ id: "acc1", kind: "PLAYER", characterId: "c1", balance: N(1_000_000), systemName: null }, { id: "w", kind: "SYSTEM", systemName: "WORLD", balance: 0n }, { id: "h", kind: "SYSTEM", systemName: "CASINO", balance: 0n });
T.gameClock.push({ id: 1, startedAt: new Date(Date.UTC(2026, 9, 1)) });
T.character.push({ id: "c1", userId: "u1", name: "Tester", hostel: "Awo", expelled: false, suspendedUntilWeek: 0, jailedUntil: null, strikes: 0, energy: 100, health: 80, happiness: 60, academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [], lastTickWeek: 99, joinedWeek: 1, class: "LAPO" });
const bal = () => T.account.find((a) => a.id === "acc1").balance;
const req = (() => { let n = 0; return () => `sync-${String(++n).padStart(6, "0")}-abcdef`; })();

/** A real bet through the real service; the fixture then pins the crash point the server drew (the draw itself is covered in bet.test.mjs). */
async function take(crash, extra = {}) {
  clock += 10 * MIN;
  const res = await A.aviatorBet(db, "u1", { stakeNaira: 1000, requestId: req(), ...extra });
  const row = T.casinoRound[T.casinoRound.length - 1]; row.crashCenti = crash;
  return { res, row, round: { ...res.round, crashCenti: crash }, sentAt: clock };
}
/** Draw the flight frame by frame the way the screen does. `frames` are performance.now() steps; returns everything that was ever shown. */
function play(flight, { step = 16, jitter = 0, hitchAt = -1, hitch = 0, tail = 4000 } = {}) {
  const shown = []; let p = flight.t0, crashShown = false, rnd = 12345;
  const end = flight.crashAt + tail;
  for (let i = 0; p < end; i++) {
    rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; p += step + (jitter ? (rnd % jitter) : 0) + (i === hitchAt ? hitch : 0);
    if (!crashShown && p >= flight.crashAt) crashShown = true;
    shown.push(crashShown ? flight.crash : sync.frameCenti(p - flight.t0, flight.crash));
  }
  return { shown, max: Math.max(...shown), final: shown[shown.length - 1], monotonic: shown.every((v, i) => !i || v >= shown[i - 1]) };
}

// ---- Tests A, B, C: the server's crash point and the animation's last value are the same number, to the hundredth ----
for (const [name, crash, text] of [["A", 396, "3.96x"], ["B", 671, "6.71x"], ["C", 105, "1.05x"]]) {
  const { res, round, sentAt } = await take(crash);
  assert.equal(res.round.crashCenti !== undefined, true, "the crash point travels with the round");
  const f = sync.makeFlight(round, res.now, 5000, 80); assert.ok(f);
  for (const opts of [{}, { step: 33, jitter: 20 }, { step: 7, hitchAt: 40, hitch: 900 }]) {
    const r = play(f, opts);
    assert.equal(r.final, crash, `${name}: final ${r.final} === server ${crash}`); assert.equal(r.max, crash, `${name}: never above the server's number`);
    assert.ok(r.monotonic, `${name}: no jumps backwards`); assert.equal(av.fmtX(r.final), text);
  }
  // the server settles the same flight on the same number
  clock = sentAt + sync.crashMs(crash) + 50; const g = await A.getAviator(db, "u1");
  assert.equal(g.round, null); assert.equal(g.last.status, "LOST"); assert.equal(g.last.crashCenti, crash, `${name}: settlement uses ${crash}`);
  assert.equal(g.history[0].crashCenti, crash, `${name}: history shows ${text}`); assert.equal(av.fmtX(g.history[0].crashCenti), text);
  console.log(`OK   test ${name}: server ${text} = animation ${text}, settled and in history`);
}

// ---- Test D: many players on the same round see the same multiplier and the same crash ----
{
  const { res, round, sentAt } = await take(671);
  const flights = [0, 40, 120, 300, 900].map((rtt, i) => sync.makeFlight(round, res.now + i * 7, 1000 * (i + 1), rtt));
  const outs = flights.map((f, i) => play(f, { step: 10 + i * 9, jitter: i * 5 }));
  for (const o of outs) { assert.equal(o.final, 671); assert.equal(o.max, 671); }
  // at the same instant of server time they agree to within the clock estimate, and they all stop on the same number
  assert.deepEqual(new Set(outs.map((o) => av.fmtX(o.final))), new Set(["6.71x"]));
  clock = sentAt + sync.crashMs(671) + 10; await A.getAviator(db, "u1");
  console.log("OK   test D: five clients, one round, one crash point");
}

// ---- Test E: reconnect in the middle of a flight: same round, same crash point, nothing new drawn ----
{
  const { res, round, sentAt } = await take(396);
  const rows = T.casinoRound.length; clock = sentAt + 5_000;
  for (let i = 0; i < 5; i++) { // refresh, lose the connection, come back: each time the server hands back the original round
    clock += 700; const g = await A.getAviator(db, "u1");
    assert.equal(g.round.id, round.id); assert.equal(g.round.crashCenti, 396, "the original crash point"); assert.equal(T.casinoRound.length, rows, "no new round was created");
    const f = sync.makeFlight(g.round, g.now, 2000 + i, 60);
    assert.equal(f.crash, 396); assert.equal(play(f).final, 396);
    assert.ok(sync.frameCenti(clock - sentAt + 1, 396) <= 396);
  }
  // the same bet request replayed (lost answer) hands back the same round too
  const rep = await A.aviatorBet(db, "u1", { stakeNaira: 1000, requestId: T.actionLog[T.actionLog.length - 1].requestId });
  assert.ok(rep.duplicate && rep.round.id === round.id && rep.round.crashCenti === 396); assert.equal(T.casinoRound.length, rows);
  void res;
  clock = sentAt + sync.crashMs(396) + 10; await A.getAviator(db, "u1");
  console.log("OK   test E: reconnect keeps the original round and crash point");
}

// ---- Test F: a delayed (or missing) server event never lets the screen go past the crash point ----
{
  const { round } = await take(396);
  const f = sync.makeFlight(round, round.startedAt, 0, 0);
  for (const late of [0, 1, 400, 5_000, 60_000, 3_600_000]) { // the screen is drawn long after the crash with no event from the server at all
    assert.equal(sync.frameCenti(sync.crashMs(396) + late, 396), 396); assert.ok(sync.centiShown(sync.crashMs(396) + late, 396) <= 396);
  }
  assert.equal(play(f, { step: 16, hitchAt: 3, hitch: 120_000 }).max, 396, "a tab that slept for two minutes wakes up on exactly the crash point");
  assert.equal(sync.frameCenti(-500, 396), 100, "a clock slightly behind never shows less than 1.00x");
  console.log("OK   test F: delayed events cannot push the display past the server's number");
}

// ---- Test G: latency, duplicates and out-of-order events change nothing ----
{
  const { res, round, sentAt } = await take(396);
  const f = sync.makeFlight(round, res.now, 0, 40);
  const ok = (ev) => sync.accept(f, ev);
  assert.ok(ok({ round, now: sentAt + 1000, seq: 1 }));
  assert.ok(ok({ round, now: sentAt + 1800, seq: 3 }));
  assert.equal(ok({ round, now: sentAt + 1400, seq: 2 }), false, "an older answer arriving after a newer one is ignored");
  assert.equal(ok({ round, now: sentAt + 1800, seq: 3 }), false, "a duplicate is ignored");
  assert.equal(ok({ round: { ...round, id: "999999" }, now: sentAt + 2500, seq: 4 }), false, "another round's event cannot touch this flight");
  assert.equal(ok({ round: { ...round, crashCenti: 408 }, now: sentAt + 2500, seq: 5 }), false, "a crash point other than the one handed over is refused");
  assert.equal(ok({ last: { id: "42", crashCenti: 408 }, round: null, now: sentAt + 2600, seq: 6 }) && f.crash !== 396, false);
  assert.equal(f.crash, 396, "nothing moved the crash point"); assert.equal(f.crashAt, f.t0 + sync.crashMs(396));
  const before = { crash: f.crash, crashAt: f.crashAt };
  for (let i = 0; i < 20; i++) ok({ round, now: sentAt + 100 * i, seq: 100 + i }); // a storm of mixed-up events
  assert.deepEqual({ crash: f.crash, crashAt: f.crashAt }, before);
  assert.equal(play(f, { step: 21, jitter: 30 }).final, 396);
  assert.equal(sync.validRound({ ...round, crashCenti: 3.96 }), false, "a fractional or missing crash point is never animated"); assert.equal(sync.makeFlight({ ...round, crashCenti: undefined }, 0, 0, 0), null);
  clock = sentAt + sync.crashMs(396) + 10; await A.getAviator(db, "u1"); await A.getAviator(db, "u1");
  assert.equal(T.casinoRound.filter((r) => r.status === "LOST").length >= 1, true);
  console.log("OK   test G: out-of-order, duplicate and stale events are ignored");
}

// ---- cash-out: the server's clock decides, on the same curve the screen draws ----
{
  const { res, round, sentAt } = await take(671); const start = bal();
  const f = sync.makeFlight(round, res.now, 0, 0);
  clock = sentAt + 4_000; const c = await A.aviatorCash(db, "u1", { roundId: round.id });
  assert.ok(c.ok); assert.equal(c.round.cashCenti, sync.frameCenti(clock - sentAt, 671), "the server paid the multiplier the animation was showing at that moment");
  assert.equal(c.round.crashCenti, 671, "settlement carries the same crash point"); assert.equal(bal(), start + av.payout(N(1000), c.round.cashCenti));
  assert.ok(c.round.cashCenti < 671); void f;
  clock = sentAt + sync.crashMs(671) + 5; const g = await A.getAviator(db, "u1"); assert.equal(g.history[0].crashCenti, 671); assert.equal(g.history[0].cashCenti, c.round.cashCenti);
  // a cash-out that reaches the server after the crash is refused even if the player's animation was behind
  const late = await take(396); const bal2 = bal(); clock = late.sentAt + sync.crashMs(396) + 1;
  const l = await A.aviatorCash(db, "u1", { roundId: late.round.id }); assert.equal(l.ok, false); assert.ok(l.late); assert.equal(l.round.crashCenti, 396); assert.match(l.error, /3\.96x/); assert.equal(bal(), bal2);
  // and one that arrives a hair before it is paid, however far ahead the player's animation ran
  const early = await take(396); clock = early.sentAt + sync.crashMs(396) - 5; const e = await A.aviatorCash(db, "u1", { roundId: early.round.id });
  assert.ok(e.ok); assert.ok(e.round.cashCenti <= 396 && e.round.cashCenti >= 395);
  console.log("OK   cash-out: arrival time on the server decides, same curve, same crash point");
}
console.log("aviator sync tests passed");
