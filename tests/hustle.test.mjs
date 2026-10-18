// tests/hustle.test.mjs: hustle limits, rewards, jail time and bail. Rules in lib/engine.js, enforcement in lib/gameService.js.
// The service tests run against the in-memory fake database, with the clock and the random numbers controlled.
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
import { HUSTLE, hustleStatus, hustleBlock, safeHustleAt, bailFor, resolveRisky, riskyJailMinutes, resolveAction } from "../lib/engine.js";
import { dayWindow } from "../lib/clock.js";
import * as G from "../lib/gameService.js";

const H = 3_600_000, MIN = 60_000, DAY = 24 * H, N = (n) => BigInt(n) * 100n;
// tests/hustle.test.mjs: hustle limits, rewards, jail time and bail. Rules in lib/engine.js, enforcement in lib/gameService.js.
// The service tests run against the in-memory fake database, with the clock and the random numbers controlled.
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
import { HUSTLE, hustleStatus, hustleBlock, safeHustleAt, bailFor, resolveRisky, riskyJailMinutes, resolveAction } from "../lib/engine.js";
import { dayWindow } from "../lib/clock.js";
import * as G from "../lib/gameService.js";

const H = 3_600_000, MIN = 60_000, DAY = 24 * H, N = (n) => BigInt(n) * 100n;

// ---------- pure rules ----------
// rewards
{ const lo = (a, b) => a, hi = (a, b) => b;
  const me = { energy: 90, health: 80, happiness: 60, academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [] };
  assert.equal(resolveAction(me, "hustle", lo).earn, N(1_500)); assert.equal(resolveAction(me, "hustle", hi).earn, N(15_000));
  assert.equal(resolveRisky({ ...me, luck: 100 }, (a, b) => (b === 100 ? 100 : a)).earn, N(100_000), "risky pays at least N100,000");
  assert.equal(resolveRisky({ ...me, luck: 100 }, (a, b) => (b === 100 ? 100 : b)).earn, N(500_000), "risky pays at most N500,000");
  for (let i = 0; i < 3000; i++) { const r = resolveRisky(me, (a, b) => a + Math.floor(Math.random() * (b - a + 1)));
    assert.ok(r.caught ? r.earn === undefined : r.earn >= N(100_000) && r.earn <= N(500_000), "risky is either caught or paid inside the range (never nothing)"); }
  for (let i = 0; i < 3000; i++) { const m = riskyJailMinutes((a, b) => a + Math.floor(Math.random() * (b - a + 1))); assert.ok(m >= 30 && m <= 90 && Number.isInteger(m), "jail is 30 to 90 minutes"); } }

// bail: N3,500 per remaining minute, falls N3,500 each minute served
{ const t0 = Date.UTC(2026, 9, 16, 12), rel = t0 + 60 * MIN;
  assert.equal(bailFor(rel, t0), N(60 * 3_500)); assert.equal(bailFor(rel, t0 + 1_000), N(60 * 3_500), "a started minute still counts");
  assert.equal(bailFor(rel, t0 + MIN), N(59 * 3_500)); assert.equal(bailFor(rel, t0 + 30 * MIN), N(30 * 3_500));
  assert.equal(bailFor(rel, rel - 1), N(3_500)); assert.equal(bailFor(rel, rel), 0n); assert.equal(bailFor(rel, rel + 5 * MIN), 0n);
  assert.equal(bailFor(rel, t0 + MIN) - bailFor(rel, t0 + 2 * MIN), N(3_500), "exactly N3,500 less for every minute served");
  assert.equal(bailFor(t0 + 30 * MIN, t0), N(105_000)); assert.equal(bailFor(t0 + 90 * MIN, t0), N(315_000), "bail runs from N105,000 to N315,000 for a risky sentence"); }

// limits
{ const d0 = Date.UTC(2026, 9, 16, 0), d1 = d0 + DAY, at = (h, a = "hustle") => ({ action: a, createdAt: new Date(d0 + h * H) });
  let s = hustleStatus([], d0, d1);
  assert.equal(s.safeLeft, 2); assert.equal(s.riskyLeft, 1); assert.equal(hustleBlock("safe", s, d0 + H), null); assert.equal(hustleBlock("risky", s, d0 + H), null);
  s = hustleStatus([at(1)], d0, d1);
  assert.equal(s.safeLeft, 1); assert.ok(hustleBlock("safe", s, d0 + 6 * H) , "6 hours has not passed after 5 hours"); assert.match(hustleBlock("safe", s, d0 + 3 * H), /6 hour break/);
  assert.equal(hustleBlock("safe", s, d0 + 7 * H), null, "allowed exactly 6 hours after");
  assert.ok(hustleBlock("safe", s, d0 + 7 * H - 1), "one millisecond early is still blocked");
  s = hustleStatus([at(1), at(8)], d0, d1);
  assert.equal(s.safeLeft, 0); assert.match(hustleBlock("safe", s, d0 + 20 * H), /both safe hustles/); assert.equal(safeHustleAt(s, d0 + 20 * H), d1);
  assert.equal(hustleBlock("safe", s, d1 + 1), null, "the daily count resets when the next in-game day starts");
  // the 6 hour gap holds across the day change
  s = hustleStatus([at(23)], d1, d1 + DAY); assert.equal(s.safeLeft, 2); assert.equal(s.safeGapEndsAt, d0 + 29 * H);
  assert.ok(hustleBlock("safe", s, d1 + 2 * H), "midnight does not skip the gap");
  assert.equal(hustleBlock("safe", s, d1 + 5 * H), null);
  // a stale answer on a screen: the day has ended, so the counts are treated as reset
  s = hustleStatus([at(1), at(8), at(2, "risky")], d0, d1); assert.ok(hustleBlock("risky", s, d0 + 9 * H)); assert.equal(hustleBlock("risky", s, d1 + 1), null);
  assert.match(hustleBlock("risky", s, d0 + 9 * H), /once|already/i);
  assert.equal(s.riskyUsed, 1); assert.equal(s.riskyLeft, 0); }

// ---------- the service, against the fake database ----------
const START = Date.UTC(2026, 9, 1, 15, 30); // the game clock starts at 15:30 UTC, so each in-game day runs 15:30 to 15:30
const models = ["character", "account", "actionLog", "ledgerEntry", "floorZero", "gameClock", "notification", "achievement", "examResult", "achievementAward", "business", "holding", "partyTicket", "bond"];
const mkPlayer = (db, over = {}) => { const T = db.T();
  const acc = { id: "acc1", kind: "PLAYER", systemName: null, characterId: "c1", balance: N(1_000_000) };
  T.account.push(acc, { id: "w", kind: "SYSTEM", systemName: "WORLD", balance: 0n }, { id: "d", kind: "SYSTEM", systemName: "DSA", balance: 0n });
  T.gameClock.push({ id: 1, startedAt: new Date(START) });
  const c = { id: "c1", userId: "u1", name: "Tester", hostel: "Awo", expelled: false, suspendedUntilWeek: 0, jailedUntil: null, strikes: 0, energy: 100, health: 80, happiness: 60,
    academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [], lastTickWeek: 0, joinedWeek: 1, class: "LAPO", ...over };
  T.character.push(c); return { c, acc }; };
const makeServiceDb = () => {
  const db = makeDb(models, { unique: { actionLog: ["characterId", "requestId"], ledgerEntry: ["idempotencyKey"] }, join: {
    character: (r, T) => ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: { name: "Tech", difficulty: 1 } }) } });
  return db; };

// fakedb does not know "select" or "$queryRaw" with results; the service only needs rows, so that is fine. catchUp reads many tables: stub it out by making the player already caught up.
const realNow = Date.now; let clock = START + 5 * DAY + H; Date.now = () => clock; // 1h into in-game day 6
const req = (() => { let n = 0; return () => `req-${String(++n).padStart(6, "0")}-abcdef`; })();
const db = makeServiceDb(); const { c: char, acc } = mkPlayer(db);
// the weekly catch-up is not what is tested here
db.T().character[0].lastTickWeek = 99;
const T = db.T();
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const day = await dayWindow(db, clock);
assert.equal(day.start, START + 5 * DAY, "in-game day boundaries follow the game clock"); assert.equal(day.end, START + 6 * DAY);

try {
  // ---- the old home-screen endpoints are retired: the hustles are done in person now ----
  // (the real rules, limits, races and N-QRS arrests run against a real database in tests/pg/hustle.pg.mjs)
  for (const name of ["hustle", "rest", "class", "study"]) { const e = await err(G.doAction(db, "u1", name, req())); assert.ok(e instanceof G.GameError && e.status === 403, name + " is refused"); }
  let e = await err(G.doAction(db, "u1", "hustle", req())); assert.match(e.message, /Oduduwa Hall/);
  e = await err(G.doAction(db, "u1", "rest", req())); assert.match(e.message, /bed/);
  e = await err(G.doRisky(db, "u1", req())); assert.equal(e.status, 403); assert.match(e.message, /Student Union Building/);
  assert.equal(T.actionLog.length, 0, "refused requests leave no trace"); assert.equal(T.account.find((a) => a.id === "acc1").balance, N(1_000_000), "and move no money");
  { const st = await G.getState(db, "u1"); assert.equal(st.hustle.safeLeft, 2); assert.equal(st.hustle.riskyLeft, 1); assert.equal(st.sleep, null, "awake"); }

  // ---- bail: worked out on the server, from the server clock ----
  clock = START + 200 * DAY; T.character[0].jailedUntil = null; T.floorZero.length = 0;
  const rel = new Date(clock + 60 * MIN); T.character[0].jailedUntil = rel; T.floorZero.push({ id: 1n, characterId: "c1", reason: "Risky hustle", startedAt: new Date(clock), releaseAt: rel, bill: N(60 * 3_500), status: "JAILED" });
  T.account.find((a) => a.id === "acc1").balance = N(1_000_000);
  { const st = await G.getState(db, "u1"); assert.equal(st.floorZero.billKobo, N(60 * 3_500).toString(), "state shows the live bail"); }
  clock += 10 * MIN + 20_000; // 10m20s served: 49m40s left: 50 minutes to pay for
  const before = T.account.find((a) => a.id === "acc1").balance;
  const paid = await G.payBail(db, "u1"); assert.equal(paid.paidKobo, N(50 * 3_500).toString());
  assert.equal(T.account.find((a) => a.id === "acc1").balance, before - N(50 * 3_500)); assert.equal(T.character[0].jailedUntil, null);
  assert.equal(T.floorZero[0].status, "PAID"); assert.equal(T.floorZero[0].bill, N(50 * 3_500), "the amount actually paid is recorded");
  e = await err(G.payBail(db, "u1")); assert.ok(e && e.status === 409, "cannot pay twice");
  // cannot afford
  const rel2 = new Date(clock + 90 * MIN); T.character[0].jailedUntil = rel2; T.floorZero.push({ id: 2n, characterId: "c1", reason: "Risky hustle", startedAt: new Date(clock), releaseAt: rel2, bill: N(90 * 3_500), status: "JAILED" });
  T.account.find((a) => a.id === "acc1").balance = N(314_999);
  e = await err(G.payBail(db, "u1")); assert.ok(e && e.status === 402, "not enough cash for N315,000"); assert.ok(T.character[0].jailedUntil, "still in Floor O"); assert.equal(T.floorZero[1].status, "JAILED");
  clock += MIN; // 89 minutes left now: N311,500, still more than the N314,999? no: it is cheaper
  const cheaper = await G.payBail(db, "u1"); assert.equal(cheaper.paidKobo, N(89 * 3_500).toString(), "bail is cheaper a minute later");
  // a suspended player can still pay to leave Floor O
  const rel3 = new Date(clock + 30 * MIN); T.character[0].jailedUntil = rel3; T.character[0].suspendedUntilWeek = 999; T.floorZero.push({ id: 3n, characterId: "c1", reason: "Risky hustle", startedAt: new Date(clock), releaseAt: rel3, bill: N(105_000), status: "JAILED" });
  T.account.find((a) => a.id === "acc1").balance = N(1_000_000); assert.equal((await G.payBail(db, "u1")).paidKobo, N(105_000).toString()); T.character[0].suspendedUntilWeek = 0;
  // the sentence runs out as they tap: free, nothing charged
  const rel4 = new Date(clock + 5 * MIN); T.character[0].jailedUntil = rel4; T.floorZero.push({ id: 4n, characterId: "c1", reason: "Risky hustle", startedAt: new Date(clock), releaseAt: rel4, bill: N(17_500), status: "JAILED" });
  clock += 5 * MIN + 1; const bal4 = T.account.find((a) => a.id === "acc1").balance; const free = await G.payBail(db, "u1"); assert.equal(free.paidKobo, "0"); assert.equal(T.account.find((a) => a.id === "acc1").balance, bal4);
  // jailed players cannot hustle at all
  T.character[0].jailedUntil = new Date(clock + 30 * MIN); e = await err(G.doAction(db, "u1", "hustle", req())); assert.ok(e && e.status === 403, "no hustling from Floor O");
  console.log("hustle tests passed");
} finally { Date.now = realNow; }

// ---------- pure rules ----------
// rewards
{ const lo = (a, b) => a, hi = (a, b) => b;
  const me = { energy: 90, health: 80, happiness: 60, academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [] };
  assert.equal(resolveAction(me, "hustle", lo).earn, N(1_500)); assert.equal(resolveAction(me, "hustle", hi).earn, N(15_000));
  assert.equal(resolveRisky({ ...me, luck: 100 }, (a, b) => (b === 100 ? 100 : a)).earn, N(100_000), "risky pays at least N100,000");
  assert.equal(resolveRisky({ ...me, luck: 100 }, (a, b) => (b === 100 ? 100 : b)).earn, N(500_000), "risky pays at most N500,000");
  for (let i = 0; i < 3000; i++) { const r = resolveRisky(me, (a, b) => a + Math.floor(Math.random() * (b - a + 1)));
    assert.ok(r.caught ? r.earn === undefined : r.earn >= N(100_000) && r.earn <= N(500_000), "risky is either caught or paid inside the range (never nothing)"); }
  for (let i = 0; i < 3000; i++) { const m = riskyJailMinutes((a, b) => a + Math.floor(Math.random() * (b - a + 1))); assert.ok(m >= 30 && m <= 90 && Number.isInteger(m), "jail is 30 to 90 minutes"); } }

// bail: N3,500 per remaining minute, falls N3,500 each minute served
{ const t0 = Date.UTC(2026, 9, 16, 12), rel = t0 + 60 * MIN;
  assert.equal(bailFor(rel, t0), N(60 * 3_500)); assert.equal(bailFor(rel, t0 + 1_000), N(60 * 3_500), "a started minute still counts");
  assert.equal(bailFor(rel, t0 + MIN), N(59 * 3_500)); assert.equal(bailFor(rel, t0 + 30 * MIN), N(30 * 3_500));
  assert.equal(bailFor(rel, rel - 1), N(3_500)); assert.equal(bailFor(rel, rel), 0n); assert.equal(bailFor(rel, rel + 5 * MIN), 0n);
  assert.equal(bailFor(rel, t0 + MIN) - bailFor(rel, t0 + 2 * MIN), N(3_500), "exactly N3,500 less for every minute served");
  assert.equal(bailFor(t0 + 30 * MIN, t0), N(105_000)); assert.equal(bailFor(t0 + 90 * MIN, t0), N(315_000), "bail runs from N105,000 to N315,000 for a risky sentence"); }

// limits
{ const d0 = Date.UTC(2026, 9, 16, 0), d1 = d0 + DAY, at = (h, a = "hustle") => ({ action: a, createdAt: new Date(d0 + h * H) });
  let s = hustleStatus([], d0, d1);
  assert.equal(s.safeLeft, 2); assert.equal(s.riskyLeft, 1); assert.equal(hustleBlock("safe", s, d0 + H), null); assert.equal(hustleBlock("risky", s, d0 + H), null);
  s = hustleStatus([at(1)], d0, d1);
  assert.equal(s.safeLeft, 1); assert.ok(hustleBlock("safe", s, d0 + 6 * H) , "6 hours has not passed after 5 hours"); assert.match(hustleBlock("safe", s, d0 + 3 * H), /6 hour break/);
  assert.equal(hustleBlock("safe", s, d0 + 7 * H), null, "allowed exactly 6 hours after");
  assert.ok(hustleBlock("safe", s, d0 + 7 * H - 1), "one millisecond early is still blocked");
  s = hustleStatus([at(1), at(8)], d0, d1);
  assert.equal(s.safeLeft, 0); assert.match(hustleBlock("safe", s, d0 + 20 * H), /both safe hustles/); assert.equal(safeHustleAt(s, d0 + 20 * H), d1);
  assert.equal(hustleBlock("safe", s, d1 + 1), null, "the daily count resets when the next in-game day starts");
  // the 6 hour gap holds across the day change
  s = hustleStatus([at(23)], d1, d1 + DAY); assert.equal(s.safeLeft, 2); assert.equal(s.safeGapEndsAt, d0 + 29 * H);
  assert.ok(hustleBlock("safe", s, d1 + 2 * H), "midnight does not skip the gap");
  assert.equal(hustleBlock("safe", s, d1 + 5 * H), null);
  // a stale answer on a screen: the day has ended, so the counts are treated as reset
  s = hustleStatus([at(1), at(8), at(2, "risky")], d0, d1); assert.ok(hustleBlock("risky", s, d0 + 9 * H)); assert.equal(hustleBlock("risky", s, d1 + 1), null);
  assert.match(hustleBlock("risky", s, d0 + 9 * H), /once|already/i);
  assert.equal(s.riskyUsed, 1); assert.equal(s.riskyLeft, 0); }

// ---------- the service, against the fake database ----------
const START = Date.UTC(2026, 9, 1, 15, 30); // the game clock starts at 15:30 UTC, so each in-game day runs 15:30 to 15:30
const models = ["character", "account", "actionLog", "ledgerEntry", "floorZero", "gameClock", "notification", "achievement", "examResult", "achievementAward", "business", "holding", "partyTicket", "bond"];
const mkPlayer = (db, over = {}) => { const T = db.T();
  const acc = { id: "acc1", kind: "PLAYER", systemName: null, characterId: "c1", balance: N(1_000_000) };
  T.account.push(acc, { id: "w", kind: "SYSTEM", systemName: "WORLD", balance: 0n }, { id: "d", kind: "SYSTEM", systemName: "DSA", balance: 0n });
  T.gameClock.push({ id: 1, startedAt: new Date(START) });
  const c = { id: "c1", userId: "u1", name: "Tester", hostel: "Awo", expelled: false, suspendedUntilWeek: 0, jailedUntil: null, strikes: 0, energy: 100, health: 80, happiness: 60,
    academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [], lastTickWeek: 0, joinedWeek: 1, class: "LAPO", ...over };
  T.character.push(c); return { c, acc }; };
const makeServiceDb = () => {
  const db = makeDb(models, { unique: { actionLog: ["characterId", "requestId"], ledgerEntry: ["idempotencyKey"] }, join: {
    character: (r, T) => ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: { name: "Tech", difficulty: 1 } }) } });
  return db; };

// fakedb does not know "select" or "$queryRaw" with results; the service only needs rows, so that is fine. catchUp reads many tables: stub it out by making the player already caught up.
const realNow = Date.now; let clock = START + 5 * DAY + H; Date.now = () => clock; // 1h into in-game day 6
const req = (() => { let n = 0; return () => `req-${String(++n).padStart(6, "0")}-abcdef`; })();
const db = makeServiceDb(); const { c: char, acc } = mkPlayer(db);
// the weekly catch-up is not what is tested here
db.T().character[0].lastTickWeek = 99;
const T = db.T();
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const day = await dayWindow(db, clock);
assert.equal(day.start, START + 5 * DAY, "in-game day boundaries follow the game clock"); assert.equal(day.end, START + 6 * DAY);

try {
  // ---- safe hustle: twice a day, 6 hours apart ----
  const a1 = await G.doAction(db, "u1", "hustle", req());
  assert.ok(a1.ok); const earned = BigInt(a1.earnedKobo); assert.ok(earned >= N(1_500) && earned <= N(15_000), "safe pays N1,500 to N15,000");
  assert.equal(T.account.find((a) => a.id === "acc1").balance, N(1_000_000) + earned);
  let e = await err(G.doAction(db, "u1", "hustle", req())); assert.ok(e instanceof G.GameError && e.status === 429 && /6 hour/.test(e.message), "second safe hustle straight away is refused");
  assert.equal(T.actionLog.filter((l) => l.action === "hustle").length, 1, "a refused hustle leaves no trace");
  clock += 5 * H + 59 * MIN; e = await err(G.doAction(db, "u1", "hustle", req())); assert.ok(e, "5h59m is too early");
  clock += 1 * MIN; const a2 = await G.doAction(db, "u1", "hustle", req()); assert.ok(a2.ok, "6 hours after the first is allowed");
  clock += 6 * H + MIN; e = await err(G.doAction(db, "u1", "hustle", req())); assert.ok(e && /both safe hustles/.test(e.message), "only two per in-game day"); // 12h08m into the day... still the same day
  assert.equal(T.actionLog.filter((l) => l.action === "hustle").length, 2);
  // the state a screen reads
  { const st = await G.getState(db, "u1"); assert.equal(st.hustle.safeLeft, 0); assert.equal(st.hustle.riskyLeft, 1); assert.equal(st.hustle.resetsAt, START + 6 * DAY); }
  // replaying a request that already went through is harmless, and pays nothing twice
  { const bal = T.account.find((a) => a.id === "acc1").balance; const r = await G.doAction(db, "u1", "hustle", T.actionLog[0].requestId); assert.ok(r.duplicate); assert.equal(T.account.find((a) => a.id === "acc1").balance, bal); }
  // next in-game day: two more
  clock = START + 6 * DAY + MIN; const a3 = await G.doAction(db, "u1", "hustle", req()); assert.ok(a3.ok, "the new in-game day gives two more"); // 12h+ since the last one, so no gap issue
  // the gap carries over midnight
  clock = START + 6 * DAY + 20 * H; char.energy = 100; db.T().character[0].energy = 100;
  await G.doAction(db, "u1", "hustle", req());
  clock = START + 7 * DAY + MIN; e = await err(G.doAction(db, "u1", "hustle", req())); assert.ok(e && /6 hour break/.test(e.message), "a new day does not skip the 6 hour gap (last was 4h ago)");
  clock = START + 7 * DAY + 2 * H + MIN; assert.ok((await G.doAction(db, "u1", "hustle", req())).ok);

  // ---- risky: once per in-game day; either paid or jailed ----
  const energyUp = () => { T.character[0].energy = 100; };
  clock = START + 10 * DAY + H; energyUp(); T.character[0].suspicion = 0; T.character[0].luck = 100;
  let outcomes = { caught: 0, paid: 0 }, last;
  for (let d = 0; d < 80; d++) { // 80 different in-game days
    clock = START + (11 + d) * DAY + H; energyUp(); T.character[0].jailedUntil = null; T.character[0].suspicion = 0; T.character[0].strikes = 0; T.character[0].suspendedUntilWeek = 0; T.floorZero.length = 0;
    const r = await G.doRisky(db, "u1", req()); last = r;
    if (r.caught) { outcomes.caught++; const fz = T.floorZero[0], mins = (+fz.releaseAt - clock) / MIN;
      assert.ok(mins >= 30 && mins <= 90, `jail ${mins} minutes is within 30 to 90`); assert.equal(fz.bill, N(Math.round(mins) * 3_500)); assert.equal(BigInt(r.billKobo), fz.bill);
      assert.ok(T.character[0].jailedUntil instanceof Date); }
    else { outcomes.paid++; const p = BigInt(r.earnedKobo); assert.ok(p >= N(100_000) && p <= N(500_000), "risky pays N100,000 to N500,000"); }
    const again = await err(G.doRisky(db, "u1", req()));
     assert.ok(again && /risky hustle today|jail|Floor O/i.test(again.message), `no second risky hustle: ${again?.message}`); }
  assert.ok(outcomes.caught > 0 && outcomes.paid > 0, `both outcomes happen (${JSON.stringify(outcomes)})`);
  // not jailed, still the same day: refused on the daily limit
  clock = START + 100 * DAY + H; energyUp(); T.character[0].strikes = 0; T.character[0].suspendedUntilWeek = 0; T.character[0].jailedUntil = null; T.character[0].luck = 100; T.floorZero.length = 0;
  T.character[0].suspicion = 0;
  const rr = await G.doRisky(db, "u1", req()); if (rr.caught) { T.character[0].jailedUntil = null; T.floorZero.length = 0; T.character[0].strikes = 0; T.character[0].suspendedUntilWeek = 0; }
  energyUp(); e = await err(G.doRisky(db, "u1", req())); assert.ok(e && e.status === 429 && /already tried a risky hustle today/.test(e.message));
  clock = START + 101 * DAY + H; energyUp(); assert.ok((await G.doRisky(db, "u1", req())).ok, "the next in-game day allows it again");

  // ---- bail: worked out on the server, from the server clock ----
  clock = START + 200 * DAY; T.character[0].jailedUntil = null; T.floorZero.length = 0;
  const rel = new Date(clock + 60 * MIN); T.character[0].jailedUntil = rel; T.floorZero.push({ id: 1n, characterId: "c1", reason: "Risky hustle", startedAt: new Date(clock), releaseAt: rel, bill: N(60 * 3_500), status: "JAILED" });
  T.account.find((a) => a.id === "acc1").balance = N(1_000_000);
  { const st = await G.getState(db, "u1"); assert.equal(st.floorZero.billKobo, N(60 * 3_500).toString(), "state shows the live bail"); }
  clock += 10 * MIN + 20_000; // 10m20s served: 49m40s left: 50 minutes to pay for
  const before = T.account.find((a) => a.id === "acc1").balance;
  const paid = await G.payBail(db, "u1"); assert.equal(paid.paidKobo, N(50 * 3_500).toString());
  assert.equal(T.account.find((a) => a.id === "acc1").balance, before - N(50 * 3_500)); assert.equal(T.character[0].jailedUntil, null);
  assert.equal(T.floorZero[0].status, "PAID"); assert.equal(T.floorZero[0].bill, N(50 * 3_500), "the amount actually paid is recorded");
  e = await err(G.payBail(db, "u1")); assert.ok(e && e.status === 409, "cannot pay twice");
  // cannot afford
  const rel2 = new Date(clock + 90 * MIN); T.character[0].jailedUntil = rel2; T.floorZero.push({ id: 2n, characterId: "c1", reason: "Risky hustle", startedAt: new Date(clock), releaseAt: rel2, bill: N(90 * 3_500), status: "JAILED" });
  T.account.find((a) => a.id === "acc1").balance = N(314_999);
  e = await err(G.payBail(db, "u1")); assert.ok(e && e.status === 402, "not enough cash for N315,000"); assert.ok(T.character[0].jailedUntil, "still in Floor O"); assert.equal(T.floorZero[1].status, "JAILED");
  clock += MIN; // 89 minutes left now: N311,500, still more than the N314,999? no: it is cheaper
  const cheaper = await G.payBail(db, "u1"); assert.equal(cheaper.paidKobo, N(89 * 3_500).toString(), "bail is cheaper a minute later");
  // a suspended player can still pay to leave Floor O
  const rel3 = new Date(clock + 30 * MIN); T.character[0].jailedUntil = rel3; T.character[0].suspendedUntilWeek = 999; T.floorZero.push({ id: 3n, characterId: "c1", reason: "Risky hustle", startedAt: new Date(clock), releaseAt: rel3, bill: N(105_000), status: "JAILED" });
  T.account.find((a) => a.id === "acc1").balance = N(1_000_000); assert.equal((await G.payBail(db, "u1")).paidKobo, N(105_000).toString()); T.character[0].suspendedUntilWeek = 0;
  // the sentence runs out as they tap: free, nothing charged
  const rel4 = new Date(clock + 5 * MIN); T.character[0].jailedUntil = rel4; T.floorZero.push({ id: 4n, characterId: "c1", reason: "Risky hustle", startedAt: new Date(clock), releaseAt: rel4, bill: N(17_500), status: "JAILED" });
  clock += 5 * MIN + 1; const bal4 = T.account.find((a) => a.id === "acc1").balance; const free = await G.payBail(db, "u1"); assert.equal(free.paidKobo, "0"); assert.equal(T.account.find((a) => a.id === "acc1").balance, bal4);
  // jailed players cannot hustle at all
  T.character[0].jailedUntil = new Date(clock + 30 * MIN); e = await err(G.doAction(db, "u1", "hustle", req())); assert.ok(e && e.status === 403, "no hustling from Floor O");
  console.log("hustle tests passed");
} finally { Date.now = realNow; }
