// tests/betsafety.test.mjs: the Bet app cannot be cheated and never pays twice. Roulette, Aviator and slips, on the in-memory fake database,
// with the clock controlled. (The maths themselves are in tests/bet.test.mjs.)
import assert from "node:assert/strict";
process.env.BET_SECRET = "test-secret";
const { makeDb } = await import("./fakedb.mjs");
const rl = await import("../lib/bet/rouletteMath.js");
const mk = await import("../lib/bet/markets.js");
const fxm = await import("../lib/bet/fixtures.js");
const { resultOf } = await import("../lib/bet/results.js");
const av = await import("../lib/bet/aviatorMath.js");
const G = await import("../lib/gameService.js");
const R = await import("../lib/bet/rouletteService.js");
const A = await import("../lib/bet/aviatorService.js");
const S = await import("../lib/bet/slipService.js");

const N = (n) => BigInt(n) * 100n, MIN = 60_000;

// ---------- the table: only real bets, only real payouts ----------
for (const ref of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf", "RED", ""]) assert.equal(rl.coverage({ type: "even", ref }), null, `even:${ref} is not a bet`);
for (const type of ["straight", "street", "corner", "column", "dozen"]) for (const ref of ["", null, undefined, " 5 ", "1e1", "0x10", "-1", "5.0", [], {}, true, "NaN"]) assert.equal(rl.coverage({ type, ref }), null, `${type}:${JSON.stringify(ref)} is not a bet`);
assert.equal(rl.coverage({ type: "split", ref: "constructor" }), null); assert.equal(rl.coverage({ type: "constructor", ref: "1" }), null); assert.equal(rl.coverage(null), null);
assert.deepEqual(rl.coverage({ type: "straight", ref: "17" }).nums, [17]); assert.deepEqual(rl.coverage({ type: "straight", ref: 0 }).nums, [0]);
assert.throws(() => rl.settle([{ type: "even", ref: "constructor", chip: 100n }], 5), "settle refuses an illegal bet instead of paying it");
// every legal bet on the table returns exactly 36/37 of what is staked over all 37 numbers (the house edge, to the kobo)
{ const legal = [];
  for (let n = 0; n <= 36; n++) legal.push({ type: "straight", ref: n });
  for (const ref of ["red", "black", "odd", "even", "low", "high"]) legal.push({ type: "even", ref });
  for (let i = 1; i <= 3; i++) legal.push({ type: "dozen", ref: i }, { type: "column", ref: i });
  for (let r = 1; r <= 34; r += 3) legal.push({ type: "street", ref: r });
  for (let r = 1; r <= 32; r++) if ((r - 1) % 3 !== 2) legal.push({ type: "corner", ref: r });
  for (let a = 0; a <= 35; a++) for (let c = a + 1; c <= 36; c++) { const b = { type: "split", ref: `${a}-${c}` }; if (rl.coverage(b)) legal.push(b); }
  legal.push({ type: "trio", ref: "0-1-2" }, { type: "trio", ref: "0-2-3" });
  for (const b of legal) { let back = 0n; for (let n = 0; n <= 36; n++) back += rl.settle([{ ...b, chip: N(100) }], n).paid; assert.equal(back, N(100) * 36n, `${b.type}:${b.ref} returns 36/37`); }
  assert.equal(legal.filter((b) => b.type === "split").length, 60, "a real table has 60 splits (57 plus the three with zero)"); }

// ---------- markets: only real markets ----------
{ const fx = fxm.fixturesOf(1000)[0];
  for (const bad of ["constructor", "__proto__", "toString", "hasOwnProperty"]) { assert.equal(mk.oddsFor(fx, bad, "h"), null); assert.equal(mk.oddsFor(fx, "1x2", bad), null); assert.equal(mk.pickWins(bad, "h", 1, 0), false); assert.equal(mk.pickWins("1x2", bad, 1, 0), false); }
  assert.ok(mk.oddsFor(fx, "1x2", "h") >= 105);
  const now = fxm.kickoffOf(1000) - 10 * MIN;
  assert.throws(() => S.buildLegs([{ fx: fx.id, mk: "constructor", pk: "h" }], now), /market/); assert.throws(() => S.buildLegs([{ fx: fx.id, mk: "1x2", pk: "constructor" }], now), /market/);
  assert.ok(S.buildLegs([{ fx: fx.id, mk: "1x2", pk: "h" }], now)[0].odds >= 105); }

// ---------- the services ----------
const models = ["character", "account", "actionLog", "ledgerEntry", "floorZero", "gameClock", "notification", "achievement", "examResult", "partyTicket", "bond", "business", "casinoRound", "betSlip"];
const db = makeDb(models, { defaults: { notification: { readAt: null }, casinoRound: { status: "FLYING", crashCenti: 0, payoutKobo: 0n, settledAt: null, cashCenti: null, autoCenti: null, data: null }, betSlip: { status: "OPEN", payoutKobo: 0n, settledAt: null, createdAt: new Date(0) } }, unique: { actionLog: ["characterId", "requestId"], ledgerEntry: ["idempotencyKey"] }, join: { character: (r, T) => ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: { name: "Tech", difficulty: 1 } }) } });
const T = db.T();
// the real database serialises one player\'s actions with a row lock (SELECT ... FOR UPDATE in loadLocked); the fake one has no locks, so make transactions take turns
{ const raw = db.$transaction; let tail = Promise.resolve(); db.$transaction = (fn) => { const p = tail.then(() => raw(fn)); tail = p.catch(() => {}); return p; }; }
const realNow = Date.now; let clock = Date.UTC(2026, 9, 20, 12, 0, 0); Date.now = () => clock;
T.account.push({ id: "acc1", kind: "PLAYER", characterId: "c1", balance: N(1_000_000), systemName: null }, { id: "w", kind: "SYSTEM", systemName: "WORLD", balance: 0n }, { id: "h", kind: "SYSTEM", systemName: "CASINO", balance: 0n });
T.gameClock.push({ id: 1, startedAt: new Date(Date.UTC(2026, 9, 1)) });
T.character.push({ id: "c1", userId: "u1", name: "Tester", hostel: "Awo", expelled: false, suspendedUntilWeek: 0, jailedUntil: null, strikes: 0, energy: 100, health: 80, happiness: 60, academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [], lastTickWeek: 99, joinedWeek: 1, class: "LAPO" });
const bal = () => T.account.find((a) => a.id === "acc1").balance;
const house = () => T.ledgerEntry.reduce((t, e) => t + (e.creditAccountId === "h" ? e.amount : 0n) - (e.debitAccountId === "h" ? e.amount : 0n), 0n);
const req = (() => { let n = 0; return () => `bet-${String(++n).padStart(6, "0")}-abcdef`; })();
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const conserved = () => { const total = T.account.reduce((t, a) => t + (a.kind === "PLAYER" ? a.balance : 0n), 0n); const fromLedger = T.ledgerEntry.reduce((t, e) => { const p = (id) => id === "acc1"; return t + (p(e.creditAccountId) ? e.amount : 0n) - (p(e.debitAccountId) ? e.amount : 0n); }, 0n); assert.equal(total, N(1_000_000) + fromLedger, "the cached balance always equals the ledger"); };

try {
  // ---- roulette ----
  let e = await err(R.spin(db, "u1", { bets: [{ type: "even", ref: "constructor", chip: 1000 }], requestId: req() })); assert.ok(e instanceof G.GameError && /not on the table/.test(e.message), "the 'wins every number' bet is refused");
  assert.equal(bal(), N(1_000_000), "a refused spin takes nothing");
  e = await err(R.spin(db, "u1", { bets: [{ type: "straight", ref: "", chip: 1000 }], requestId: req() })); assert.ok(e, "an empty ref is not a bet on zero");
  e = await err(R.spin(db, "u1", { bets: [{ type: "straight", ref: 5, chip: 99 }], requestId: req() })); assert.ok(e, "chips below N100 are refused");
  e = await err(R.spin(db, "u1", { bets: [{ type: "straight", ref: 5, chip: 12.5 }], requestId: req() })); assert.ok(e, "fractional chips are refused");
  e = await err(R.spin(db, "u1", { bets: [{ type: "straight", ref: 5, chip: 600_000 }], requestId: req() })); assert.ok(e && /limit/.test(e.message), "the table limit holds");
  // a spin: stake out, exactly the right payout back, one round row
  const rid = req(), before = bal();
  const sp = await R.spin(db, "u1", { bets: [{ type: "straight", ref: 7, chip: 1000 }, { type: "even", ref: "red", chip: 2000 }], requestId: rid });
  const expected = rl.settle([{ type: "straight", ref: "7", chip: N(1000) }, { type: "even", ref: "red", chip: N(2000) }], sp.number);
  assert.equal(sp.paidKobo, expected.paid.toString()); assert.equal(bal(), before - N(3000) + expected.paid, "balance = before - stake + payout");
  assert.equal(T.casinoRound.filter((r) => r.game === "ROULETTE").length, 1); conserved();
  // the same request again (a retry after a lost answer): the SAME result comes back, and nothing is taken or paid twice
  const again = await R.spin(db, "u1", { bets: [{ type: "straight", ref: 7, chip: 1000 }, { type: "even", ref: "red", chip: 2000 }], requestId: rid });
  assert.ok(again.duplicate); assert.equal(again.number, sp.number); assert.equal(again.paidKobo, sp.paidKobo); assert.equal(bal(), before - N(3000) + expected.paid, "no second charge or payout");
  assert.equal(T.casinoRound.filter((r) => r.game === "ROULETTE").length, 1);
  // two spins at once cannot spend the same cash twice
  T.account.find((a) => a.id === "acc1").balance = N(1500);
  const both = await Promise.all([R.spin(db, "u1", { bets: [{ type: "even", ref: "low", chip: 1000 }], requestId: req() }).catch((x) => x), R.spin(db, "u1", { bets: [{ type: "even", ref: "low", chip: 1000 }], requestId: req() }).catch((x) => x)]);
  assert.ok(bal() >= 0n); assert.ok(both.some((x) => x instanceof G.GameError || x.ok), "only what the player has can be staked");
  T.account.find((a) => a.id === "acc1").balance = N(1_000_000); T.ledgerEntry.length = 0; T.casinoRound.length = 0; T.actionLog.length = 0;

  // ---- aviator ----
  clock += 10 * MIN; const startBal = bal();
  const b1 = await A.aviatorBet(db, "u1", { stakeNaira: 1000, requestId: req() }); assert.ok(b1.ok && !("crashCenti" in b1.round), "the crash point is never sent while the plane is up");
  assert.equal(bal(), startBal - N(1000), "the stake leaves at once");
  const fly = T.casinoRound[0]; fly.crashCenti = 500; // pin the secret crash at 5.00x for the test
  e = await err(A.aviatorBet(db, "u1", { stakeNaira: 1000, requestId: req() })); assert.ok(e && e.status === 409, "one plane at a time");
  assert.equal(bal(), startBal - N(1000), "the refused second bet took nothing");
  // a repeat of the same bet request returns the flight it started, and charges nothing more
  { const rid2 = T.actionLog.find((l) => l.action === "aviator:bet").requestId; const rep = await A.aviatorBet(db, "u1", { stakeNaira: 1000, requestId: rid2 }); assert.ok(rep.duplicate && rep.round && rep.round.id === b1.round.id, "a repeat hands back the same flight"); assert.equal(bal(), startBal - N(1000)); }
  // cash out at the server's multiplier
  clock += 10_000; // 10s into the flight
  const c1 = await A.aviatorCash(db, "u1", { roundId: b1.round.id }); const want = av.payout(N(1000), av.centiAt(10));
  assert.ok(c1.ok && c1.round.status === "WON"); assert.equal(c1.round.payoutKobo, want.toString(), "paid at the multiplier at the moment it arrived"); assert.equal(bal(), startBal - N(1000) + want);
  // cashing out again pays nothing more
  const c2 = await A.aviatorCash(db, "u1", { roundId: b1.round.id }); assert.ok(c2.already); assert.equal(bal(), startBal - N(1000) + want, "no double payout");
  // two cash-outs racing: one payout
  clock += MIN; const b2 = await A.aviatorBet(db, "u1", { stakeNaira: 500, requestId: req() }); T.casinoRound[1].crashCenti = 100000; clock += 5_000;
  const bal2 = bal(); await Promise.all([A.aviatorCash(db, "u1", { roundId: b2.round.id }), A.aviatorCash(db, "u1", { roundId: b2.round.id })]);
  assert.equal(T.ledgerEntry.filter((x) => x.idempotencyKey === `av:win:${b2.round.id}`).length, 1, "one payout ledger row"); assert.equal(bal(), bal2 + av.payout(N(500), av.centiAt(5)));
  // too late: the plane has gone
  clock += MIN; const b3 = await A.aviatorBet(db, "u1", { stakeNaira: 700, requestId: req() }); T.casinoRound[2].crashCenti = 200; clock += 30_000; const bal3 = bal();
  const late = await A.aviatorCash(db, "u1", { roundId: b3.round.id }); assert.equal(late.ok, false); assert.ok(late.late); assert.equal(bal(), bal3, "nothing paid for a plane that flew away");
  const late2 = await A.aviatorCash(db, "u1", { roundId: b3.round.id }); assert.ok(late2.late && late2.ok === false, "asking again after it was settled as lost is still 'too late', never a win");
  assert.equal(T.casinoRound[2].status, "LOST");
  // an automatic cash-out is paid by the server even if nobody is watching
  clock += MIN; const b4 = await A.aviatorBet(db, "u1", { stakeNaira: 1000, autoCashout: 2, requestId: req() }); T.casinoRound[3].crashCenti = 900; const bal4 = bal(); clock += 20_000;
  const g4 = await A.getAviator(db, "u1"); assert.equal(g4.round, null); assert.equal(g4.last.status, "WON"); assert.equal(g4.last.cashCenti, 200); assert.equal(bal(), bal4 + av.payout(N(1000), 200), "auto cash-out paid at exactly 2.00x");
  await A.getAviator(db, "u1"); assert.equal(T.ledgerEntry.filter((x) => x.idempotencyKey === `av:win:${b4.round.id}`).length, 1, "polling again pays nothing more");
  // the win cap: a big stake is stopped at N5,000,000 even if the plane keeps climbing
  clock += MIN; T.account.find((a) => a.id === "acc1").balance = N(1_000_000); T.ledgerEntry.length = 0;
  const b5 = await A.aviatorBet(db, "u1", { stakeNaira: 100_000, requestId: req() }); T.casinoRound[4].crashCenti = 90000; clock += 120_000; const g5 = await A.getAviator(db, "u1");
  assert.equal(g5.last.status, "WON"); assert.equal(g5.last.payoutKobo, (500_000_000n).toString(), "capped at N5,000,000"); assert.equal(g5.last.cashCenti, 5000);
  e = await err(A.aviatorBet(db, "u1", { stakeNaira: 99, requestId: req() })); assert.ok(e); e = await err(A.aviatorBet(db, "u1", { stakeNaira: 1000, autoCashout: 1.0, requestId: req() })); assert.ok(e);
  conserved();

  // ---- sports slips ----
  T.casinoRound.length = 0; T.account.find((a) => a.id === "acc1").balance = N(1_000_000); T.ledgerEntry.length = 0; T.actionLog.length = 0;
  clock = fxm.kickoffOf(fxm.roundOf(clock) + 2) - 20 * MIN; // a few minutes before a round that is still ahead
  const round = fxm.roundOf(clock) + 1, fxs = fxm.fixturesOf(round);
  const winPick = (f) => { const r = resultOf(f.id); for (const m of ["1x2", "dc", "ou25", "gg"]) for (const pk of Object.keys(mk.MARKETS[m].picks)) if (mk.pickWins(m, pk, r.h, r.a)) return { fx: f.id, mk: m, pk }; };
  const losePick = (f) => { const r = resultOf(f.id); for (const m of ["1x2", "dc", "ou25", "gg"]) for (const pk of Object.keys(mk.MARKETS[m].picks)) if (!mk.pickWins(m, pk, r.h, r.a)) return { fx: f.id, mk: m, pk }; };
  const startS = bal(), legsWin = [winPick(fxs[0]), winPick(fxs[1])], legsLose = [winPick(fxs[2]), losePick(fxs[3])];
  const sw = await S.placeSlip(db, "u1", { legs: legsWin, stakeNaira: 1000, requestId: req() }), sl = await S.placeSlip(db, "u1", { legs: legsLose, stakeNaira: 2000, requestId: req() });
  assert.equal(bal(), startS - N(3000), "stakes leave at once"); assert.ok(sw.slip.status === "OPEN");
  // odds and payout come from the server's own table, whatever the browser claims
  { const lp = losePick(fxs[4]), tamper = await S.placeSlip(db, "u1", { legs: [{ ...lp, odds: 9999 }], stakeNaira: 100, requestId: req() }); assert.equal(tamper.slip.odds, (mk.oddsFor(fxs[4], lp.mk, lp.pk) / 100).toFixed(2), "browser odds are ignored"); }
  // a repeat of the same request makes no second slip and takes nothing more
  { const rid3 = T.actionLog.find((l) => l.action === "bet:slip").requestId; const b0 = bal(); const rep = await S.placeSlip(db, "u1", { legs: legsWin, stakeNaira: 1000, requestId: rid3 }); assert.ok(rep.duplicate); assert.equal(bal(), b0); assert.equal(T.betSlip.length, 3); }
  // betting closes at kickoff
  clock = fxs[0].ko - 1000; e = await err(S.placeSlip(db, "u1", { legs: [winPick(fxs[5])], stakeNaira: 100, requestId: req() })); assert.ok(e && e.status === 409, "no bets in the last 3 seconds");
  clock = fxs[0].ko + 10 * MIN; e = await err(S.placeSlip(db, "u1", { legs: [winPick(fxs[5])], stakeNaira: 100, requestId: req() })); assert.ok(e && e.status === 409, "no bets after kickoff");
  // mid match nothing is settled; after full time winners are paid once and losers pay nothing
  clock = fxs[0].ko + 60_000; const mid = await S.getSlips(db, "u1"); assert.deepEqual(mid.settled, []);
  clock = fxs[0].ko + fxm.MATCH_MS + 1000; const bBefore = bal();
  const done = await S.getSlips(db, "u1"); const wonRow = T.betSlip[0], lostRow = T.betSlip[1];
  assert.equal(wonRow.status, "WON"); assert.equal(lostRow.status, "LOST"); assert.equal(bal(), bBefore + wonRow.potentialKobo, "only the winning slip pays, exactly its potential win");
  assert.equal(wonRow.potentialKobo, mk.payoutOf(N(1000), S.buildLegs(legsWin, fxs[0].ko - 600_000)), "potential win = stake x total odds, as fixed at placing time");
  await S.getSlips(db, "u1"); await Promise.all([S.getSlips(db, "u1"), S.getSlips(db, "u1")]); assert.equal(bal(), bBefore + wonRow.potentialKobo, "settling again (or at the same time) never pays twice");
  assert.equal(T.ledgerEntry.filter((x) => /^bet:win:/.test(x.idempotencyKey)).length, 1); assert.equal(done.settled.length, 3);
  // each settlement carries its saved note's id, so the screen can announce the result ONCE (same toast id from either source); kinds say won / lost
  for (const x of done.settled) { const note = T.notification.find((n) => String(n.id) === x.noteId); assert.ok(note, "the settlement names its note"); assert.equal(note.kind, x.status === "WON" ? "bet:won" : "bet:lost"); }
  assert.equal(T.notification.filter((n) => /^bet:/.test(n.kind)).length, 3, "one note per settled slip, none added by settling again");
  { const { markAllRead } = await import("../lib/notifications.js"), cid = T.character[0].id, ids = done.settled.map((x) => x.noteId);
    await markAllRead(db, cid, [ids[0], "not-a-number"]);
    assert.equal(T.notification.filter((n) => n.readAt).length, 1, "marking by id reads only that note"); assert.ok(T.notification.find((n) => String(n.id) === ids[0]).readAt);
    await markAllRead(db, cid, []); assert.equal(T.notification.filter((n) => n.readAt).length, 1, "an empty id list reads nothing");
    await markAllRead(db, cid); assert.equal(T.notification.filter((n) => n.readAt).length, T.notification.length, "no ids: everything unread is read (existing behaviour)"); }
  conserved();
  // the house account holds the difference
  assert.equal(house(), -(bal() - N(1_000_000)), "what the player gained is what the house lost");
  console.log("bet safety tests passed");
} finally { Date.now = realNow; }
