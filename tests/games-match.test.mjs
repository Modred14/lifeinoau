// tests/games-match.test.mjs: matchmaking, wagers, settlement and rematches (lib/games/matchService.js) against the in-memory database.
// Row locks and the advisory lock are PostgreSQL features the in-memory database does not have, so every transaction here runs one at a time (that is what the locks guarantee in
// production). What this proves is the LOGIC: exactly-once payout, refunds, idempotent requests, one match per player, timeouts, rematch rules, and money that always adds up.
import { register } from "node:module";
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
register(new URL("./fixtures/games-loader.mjs", import.meta.url));
const svc = await import("../lib/games/matchService.js");
const { GameError } = await import("./fixtures/games-gameService-stub.mjs");
const { ENGINES, AI_SETTINGS } = await import("../lib/games/index.js");

const db = makeDb(["character", "account", "ledgerEntry", "gameMatch", "gameQueue", "gameSeat", "notification", "actionLog", "block"], {
  unique: { gameSeat: ["characterId"], gameQueue: ["characterId"], ledgerEntry: ["idempotencyKey"], actionLog: ["characterId", "requestId"] },
  defaults: { gameMatch: { version: 0, turn: 0, turnDeadline: null, winnerSeat: null, result: null, reason: null, payoutKobo: 0n, drawOffer: null, rematch: null, rematchOfId: null, rids: [], startedAt: null, finishedAt: null }, gameQueue: {}, character: { jailedUntil: null, suspendedUntil: null, expelled: false, expelledUntil: null } },
  join: { character: (r, T) => r && ({ ...r, account: T.account.find((a) => a.characterId === r.id) ?? null }) },
});
db.$queryRaw = async () => []; // locks do nothing here
let chain = Promise.resolve(), rawTx = db.$transaction;
db.$transaction = (fn) => { const run = chain.then(() => rawTx(fn)); chain = run.catch(() => {}); return run; };
db.account.upsert = async ({ where, create }) => (await db.account.findUnique({ where })) ?? db.account.create({ data: { id: "a_" + create.systemName, ...create } });
const prevCreate = db.gameMatch.create; db.gameMatch.create = (a) => prevCreate({ data: { createdAt: new Date(), ...a.data } });
const prevQ = db.gameQueue.create; db.gameQueue.create = (a) => prevQ({ data: { joinedAt: new Date(), ...a.data } });

let n = 0; const rq = () => "rq-" + String(++n).padStart(6, "0");
const N = (x) => BigInt(x) * 100n;
async function player(name, naira) {
  const c = await db.character.create({ data: { id: "c_" + name, userId: "u_" + name, name, level: 100, hostel: "Awo" } });
  await db.account.create({ data: { id: "a_" + name, kind: "PLAYER", characterId: c.id, balance: N(naira) } });
  return { id: c.id, uid: "u_" + name, name };
}
const bal = async (p) => (await db.account.findUnique({ where: { characterId: p.id } })).balance;
const house = async () => { const a = await db.account.findUnique({ where: { systemName: "GAMES" } }); if (!a) return 0n;
  const L = db.T().ledgerEntry; return L.filter((e) => e.creditAccountId === a.id).reduce((t, e) => t + e.amount, 0n) - L.filter((e) => e.debitAccountId === a.id).reduce((t, e) => t + e.amount, 0n); };
const rejects = async (label, fn, re) => { try { await fn(); } catch (e) { assert.ok(e instanceof GameError, `${label}: expected a GameError, got ${e?.stack}`); if (re) assert.match(e.message, re, label); console.log("OK   refused:", label, "->", e.message); return; } assert.fail(label + ": should have been refused"); };
const ok = (m) => console.log("OK  ", m);
const A = await player("Ada", 10_000), B = await player("Bola", 10_000), C = await player("Chidi", 50), D = await player("Dayo", 10_000);
const total = async () => (await Promise.all([A, B, C, D].map(bal))).reduce((t, x) => t + x, 0n) + (await house());
const START = await total(); let adj = 0n; // adj: what the test itself added or took outside the ledger

// ---------- a friend challenge
const ch = (p, to, game, stake) => svc.challenge(db, p.uid, { to, game, stakeNaira: stake, requestId: rq() });
await rejects("challenge yourself", () => ch(A, "ada", "LUDO", 0), /yourself/);
await rejects("unknown player", () => ch(A, "Nobody Here", "LUDO", 0), /No player/);
await rejects("unknown game", () => ch(A, "Bola", "BINGO", 0), /Pick a game/);
await rejects("wager below the minimum", () => ch(A, "Bola", "LUDO", 50), /wager/);
await rejects("wager above the maximum", () => ch(A, "Bola", "LUDO", 500_000), /wager/);
await rejects("challenger cannot afford the wager", () => ch(C, "Ada", "LUDO", 1_000), /afford/);
await db.block.create({ data: { blockerId: B.id, blockedId: A.id } });
await rejects("blocked either way", () => ch(A, "Bola", "LUDO", 0), /cannot challenge/);
db.T().block.length = 0;
const id1 = (await ch(A, "bola", "CONNECT4", 1_000)).id; ok("Ada challenged Bola to Connect Four for ₦1,000 (name match ignores case)");
let lobby = await svc.getLobby(db, B.uid); assert.equal(lobby.incoming.length, 1); assert.equal(lobby.incoming[0].poolKobo, "200000"); assert.equal(lobby.incoming[0].from, "Ada");
assert.equal(await bal(A), N(10_000)); ok("the invitation shows game, opponent and pool, and nothing is taken yet");
await rejects("a stranger cannot answer someone else's challenge", () => svc.respond(db, C.uid, { matchId: id1, accept: true, requestId: rq() }), /could not be found/);
const rq1 = rq(); const both = await Promise.all([svc.respond(db, B.uid, { matchId: id1, accept: true, requestId: rq1 }), svc.respond(db, B.uid, { matchId: id1, accept: true, requestId: rq1 }), svc.respond(db, B.uid, { matchId: id1, accept: true, requestId: rq() })]);
assert.equal(both.filter((r) => r.started && !r.duplicate).length, 1); assert.equal(db.T().gameMatch.filter((m) => m.status === "ACTIVE").length, 1);
assert.equal(await bal(A), N(9_000)); assert.equal(await bal(B), N(9_000)); assert.equal(await house(), N(2_000)); assert.equal(db.T().gameSeat.length, 2);
ok("accepted three times at once -> one match, both ₦1,000 wagers in escrow (₦9,000 each left, ₦2,000 held)");
await rejects("already in a match: cannot search", () => svc.joinQueue(db, A.uid, { game: "LUDO", stakeNaira: 0, requestId: rq() }), /already in a match/);
await rejects("already in a match: cannot challenge", () => ch(A, "Dayo", "LUDO", 0), /already in a match/);
await rejects("cannot challenge someone who is playing", () => ch(D, "Ada", "LUDO", 0), /in a match right now/);

// ---------- playing and winning: the winner takes the whole pool, once
let m = (await svc.getMatch(db, A.uid, id1)).match; assert.equal(m.escrowKobo, "200000"); assert.equal(m.status, "ACTIVE");
const byUid = { [A.uid]: A, [B.uid]: B }, other = (u) => (u === A.uid ? B.uid : A.uid);
async function drive(id, uidWinner) { // the winner stacks column 0 (four in a column); the loser alternates columns 1 and 2 (a 2x2 block, never four) so the winner is first to four whoever starts
  let k = 0;
  for (let i = 0; i < 20; i++) {
    const mm = (await svc.getMatch(db, A.uid, id)).match; if (mm.status !== "ACTIVE") return mm;
    const mover = (mm.seat === mm.turn) ? A.uid : B.uid, col = mover === uidWinner ? 0 : 1 + (k++ % 2);
    await svc.move(db, mover, { matchId: id, action: { type: "drop", col }, requestId: rq() });
  }
  throw new Error("match did not end");
}
const wrongUid = (m.seat === m.turn) ? B.uid : A.uid;
await rejects("moving out of turn", () => svc.move(db, wrongUid, { matchId: id1, action: { type: "drop", col: 0 }, requestId: rq() }), /not your turn/);
await rejects("a player cannot claim the win", () => svc.move(db, A.uid, { matchId: id1, action: { type: "win" }, requestId: rq() }), /drop a disc/i);
await rejects("outsider cannot read the match", () => svc.getMatch(db, D.uid, id1), /could not be found/);
const fin = await drive(id1, A.uid);
assert.equal(fin.status, "FINISHED"); assert.equal(fin.outcome, "WON"); assert.equal(await bal(A), N(11_000)); assert.equal(await bal(B), N(9_000)); assert.equal(await house(), 0n);
assert.equal(db.T().ledgerEntry.filter((e) => e.idempotencyKey === `game:payout:${id1}`).length, 1); assert.equal(db.T().gameSeat.length, 0);
ok("Ada won: she holds ₦11,000, Bola ₦9,000, escrow is empty, exactly one payout entry, both seats freed");
const late = await svc.move(db, B.uid, { matchId: id1, action: { type: "drop", col: 3 }, requestId: rq() }); assert.equal(late.over, true);
await svc.resign(db, B.uid, { matchId: id1 }); await svc.drawOffer(db, A.uid, { matchId: id1, op: "offer" });
assert.equal(db.T().ledgerEntry.filter((e) => e.idempotencyKey.startsWith("game:payout:")).length, 1); assert.equal(await bal(A), N(11_000)); ok("moves, resigns and draw offers after the end change nothing and pay nothing");
let hist = await svc.getHistory(db, A.uid); assert.equal(hist.history[0].outcome, "WON"); assert.equal(hist.history[0].winningsKobo, "200000"); assert.equal(hist.history[0].netKobo, "100000"); assert.equal(hist.history[0].opponent, "Bola");
hist = await svc.getHistory(db, B.uid); assert.equal(hist.history[0].outcome, "LOST"); assert.equal(hist.history[0].netKobo, "-100000"); ok("history lists game, opponent, wager, result, winnings and net for both players");
assert.equal(await total(), START); ok("money is conserved: balances + escrow equal the start");
const notes = db.T().notification.filter((x) => x.characterId === A.id).map((x) => x.body); assert.ok(notes.some((b) => /won ₦2,000/.test(b))); ok("the winner was notified of the prize");

// ---------- the rematch: never automatic, both agree, the wager is confirmed
await rejects("rematch of a stranger's match", () => svc.rematchAsk(db, D.uid, { matchId: id1, requestId: rq() }), /could not be found/);
await svc.rematchAsk(db, B.uid, { matchId: id1, stakeNaira: 2_000, requestId: rq() });
assert.equal(db.T().gameSeat.length, 0); assert.equal(await bal(B), N(9_000)); ok("Bola asked for a rematch at ₦2,000: nothing started, nothing taken");
await rejects("the asker cannot ask again over a live request to the rival", () => svc.rematchAsk(db, A.uid, { matchId: id1, requestId: rq() }), /already asked/);
lobby = await svc.getLobby(db, A.uid); assert.equal(lobby.rematch.stakeNaira, 2_000); assert.equal(lobby.rematch.opponent, "Bola");
await svc.rematchReply(db, A.uid, { matchId: id1, accept: false, requestId: rq() });
await rejects("answering a declined rematch", () => svc.rematchReply(db, A.uid, { matchId: id1, accept: true, requestId: rq() }), /no rematch/);
assert.equal(db.T().gameSeat.length, 0); ok("declined: no match, no money moved");
await svc.rematchAsk(db, A.uid, { matchId: id1, stakeNaira: 1_000, requestId: rq() }); ok("a fresh ask after a decline is allowed");
await db.character.update({ where: { id: B.id }, data: { suspendedUntil: new Date(Date.now() + 60_000) } });
await rejects("accepting while suspended", () => svc.rematchReply(db, B.uid, { matchId: id1, accept: true, requestId: rq() }), /suspended/);
await db.character.update({ where: { id: B.id }, data: { suspendedUntil: null } });
const old = db.T().gameMatch.find((x) => String(x.id) === id1); const keep = old.rematch.at; old.rematch.at = Date.now() - 120_000;
await rejects("accepting an expired rematch", () => svc.rematchReply(db, B.uid, { matchId: id1, accept: true, requestId: rq() }), /expired/); db.T().gameMatch.find((x) => String(x.id) === id1).rematch.at = keep; // (a refused request rolls the rows back, so look the row up again)
const rr = await svc.rematchReply(db, B.uid, { matchId: id1, accept: true, requestId: rq() }); assert.ok(rr.started);
assert.equal(await bal(A), N(10_000)); assert.equal(await bal(B), N(8_000)); assert.equal(await house(), N(2_000)); ok("both accepted: the rematch started with ₦1,000 from each");
const again = await svc.rematchReply(db, B.uid, { matchId: id1, accept: true, requestId: rq() }); assert.equal(again.duplicate, true); assert.equal(await house(), N(2_000)); ok("accepting again does not start a second match");
const id2 = rr.id; assert.equal(db.T().gameMatch.find((x) => String(x.id) === id2).mode, "REMATCH");

// ---------- draw by agreement refunds both
await svc.drawOffer(db, A.uid, { matchId: id2, op: "offer" }); await rejects("accepting an offer that was never made", () => svc.drawOffer(db, A.uid, { matchId: id2, op: "accept" }), /no draw offer/);
let dm = (await svc.getMatch(db, B.uid, id2)).match; assert.equal(dm.drawOffer, "theirs");
const dr = await svc.drawOffer(db, B.uid, { matchId: id2, op: "accept" }); assert.equal(dr.match.outcome, "DRAW");
assert.equal(await bal(A), N(11_000)); assert.equal(await bal(B), N(9_000)); assert.equal(await house(), 0n); assert.equal(db.T().ledgerEntry.filter((e) => e.idempotencyKey.startsWith(`game:refund:${id2}:`)).length, 2); assert.equal(dr.match.payoutKobo, "0");
ok("an agreed draw returned each player's wager exactly once (no winner)");

// ---------- a draw offer is declined by simply moving
const f3 = (await ch(A, "Bola", "TICTACTOE", 500)).id; await svc.respond(db, B.uid, { matchId: f3, accept: true, requestId: rq() });
let t3 = (await svc.getMatch(db, A.uid, f3)).match; const first = t3.yourTurn ? A.uid : B.uid;
await svc.drawOffer(db, other(first), { matchId: f3, op: "offer" }); await svc.move(db, first, { matchId: f3, action: { type: "mark", cell: 4 }, requestId: rq() });
t3 = (await svc.getMatch(db, A.uid, f3)).match; assert.equal(t3.drawOffer, null); ok("making a move declined the open draw offer");
// resign
const rs = await svc.resign(db, A.uid, { matchId: f3 }); assert.equal(rs.match.outcome, "LOST"); assert.equal(rs.match.result, "FORFEIT"); assert.equal(await bal(B), N(9_500)); assert.equal(await bal(A), N(10_500)); ok("resigning forfeits the pool to the rival (Bola ₦9,500, Ada ₦10,500)");

// ---------- time runs out
const f4 = (await ch(B, "Ada", "CHECKERS", 1_000)).id; await svc.respond(db, A.uid, { matchId: f4, accept: true, requestId: rq() });
let c4 = (await svc.getMatch(db, A.uid, f4)).match; const slowUid = c4.yourTurn ? A.uid : B.uid;
const r4 = db.T().gameMatch.find((x) => String(x.id) === f4); r4.turnDeadline = new Date(Date.now() - 5_000);
const after = (await svc.getMatch(db, slowUid, f4)).match; assert.equal(after.result, "TIMEOUT"); assert.equal(after.outcome, "LOST");
assert.equal(await house(), 0n); ok("the player whose clock ran out lost on time, and the rival took the pool");
assert.equal((await svc.getMatch(db, other(slowUid), f4)).match.outcome, "WON");
// brief disconnect: deadline in the future -> nothing happens however long they were away
const f5 = (await ch(A, "Bola", "CHECKERS", 0)).id; await svc.respond(db, B.uid, { matchId: f5, accept: true, requestId: rq() });
const g5 = await svc.getMatch(db, A.uid, f5); assert.equal(g5.match.status, "ACTIVE"); db.T().gameMatch.find((x) => String(x.id) === f5).turnDeadline = new Date(Date.now() + 20_000); assert.equal((await svc.getMatch(db, B.uid, f5)).match.status, "ACTIVE"); ok("a player who is away for a few seconds loses nothing");
// the sweep settles matches nobody is watching, and the hard cap voids
db.T().gameMatch.find((x) => String(x.id) === f5).turnDeadline = new Date(Date.now() - 60_000);
await svc.sweepStale(db, Date.now(), true); assert.equal((await svc.getMatch(db, A.uid, f5)).match.status, "FINISHED"); ok("a match nobody is watching is settled by the sweep");
const f6 = (await ch(A, "Bola", "CHESS", 1_000)).id; await svc.respond(db, B.uid, { matchId: f6, accept: true, requestId: rq() });
const b6 = await bal(A); const r6 = db.T().gameMatch.find((x) => String(x.id) === f6); r6.startedAt = new Date(Date.now() - 13 * 3_600_000);
const v6 = (await svc.getMatch(db, A.uid, f6)).match; assert.equal(v6.status, "VOID"); assert.equal(await bal(A), b6 + N(1_000)); assert.equal(await house(), 0n); ok("a match past the 12-hour cap is voided and both wagers come back");

// ---------- random opponents (real players only: the AI fallback is switched off here and has its own test, tests/games-ai-match.test.mjs)
AI_SETTINGS.enabled = false;
const q = (p, game, stake) => svc.joinQueue(db, p.uid, { game, stakeNaira: stake, requestId: rq() });
let r = await q(A, "POOL", 500); assert.equal(r.searching, true); r = await q(A, "POOL", 500); assert.equal(r.duplicate, true); assert.equal(db.T().gameQueue.length, 1); ok("searching twice is one search; you are never matched with yourself");
r = await q(B, "POOL", 1_000); assert.equal(r.searching, true); assert.equal(db.T().gameQueue.length, 2); ok("a different wager does not match");
await db.block.create({ data: { blockerId: D.id, blockedId: A.id } }); r = await q(D, "POOL", 500); assert.equal(r.searching, true); assert.equal(db.T().gameQueue.length, 3); db.T().block.length = 0; ok("blocked players are not matched");
await rejects("cannot search with a wager you cannot afford", () => q(C, "POOL", 1_000), /afford/);
r = await svc.leaveQueue(db, D.uid); assert.equal(db.T().gameQueue.some((x) => x.characterId === D.id), false); ok("cancelling the search removes you from the queue");
const drain = (await bal(A)) - N(100); adj -= drain; await db.account.update({ where: { id: "a_Ada" }, data: { balance: { decrement: drain } } }); // Ada can no longer cover her ₦500 while she waits
r = await q(D, "POOL", 500); assert.equal(r.searching, true); assert.equal(db.T().gameQueue.some((x) => x.characterId === A.id), false); ok("a waiting player who can no longer afford the wager is dropped, not matched");
adj += N(10_000); await db.account.update({ where: { id: "a_Ada" }, data: { balance: { increment: N(10_000) } } });
const preTotal = await total();
r = await q(A, "POOL", 500); assert.equal(r.matched, true); const rid = r.id; const rm = (await svc.getMatch(db, D.uid, rid)).match; assert.equal(rm.mode, "RANDOM"); assert.equal(rm.opponent.name, "Ada"); assert.equal(db.T().gameQueue.length, 1);
assert.equal(await house(), N(1_000)); ok("a compatible opponent was found: the match started, both ₦500 wagers are in escrow, both left the queue");
await svc.resign(db, D.uid, { matchId: rid }); assert.equal(await total(), preTotal); await svc.leaveQueue(db, B.uid);
AI_SETTINGS.enabled = true;

// ---------- custody and eligibility
await db.character.update({ where: { id: D.id }, data: { jailedUntil: new Date(Date.now() + 3_600_000) } });
const cj = (await ch(D, "Bola", "TICTACTOE", 500)).id; await svc.respond(db, B.uid, { matchId: cj, accept: true, requestId: rq() }); ok("a player in custody can challenge and play (the phone is not the cell door)");
await svc.resign(db, D.uid, { matchId: cj }); await db.character.update({ where: { id: D.id }, data: { jailedUntil: null } });
await db.character.update({ where: { id: D.id }, data: { expelled: true, expelledUntil: new Date(Date.now() + 3_600_000) } });
await rejects("an expelled player cannot start a match", () => ch(D, "Bola", "LUDO", 0), /expelled/);
await rejects("nobody can challenge an expelled player", () => ch(B, "Dayo", "LUDO", 0), /not allowed/);
await db.character.update({ where: { id: D.id }, data: { expelled: false, expelledUntil: null } });

// ---------- a failure while starting leaves nothing half done
const realCreate = db.ledgerEntry.create; let calls = 0; db.ledgerEntry.create = async (a) => { if (++calls === 2) throw new Error("database went away"); return realCreate(a); };
const f7 = (await ch(A, "Bola", "LUDO", 1_000)).id; const bA = await bal(A), bB = await bal(B);
await assert.rejects(() => svc.respond(db, B.uid, { matchId: f7, accept: true, requestId: rq() }), /database went away/);
db.ledgerEntry.create = realCreate; assert.equal(await bal(A), bA); assert.equal(await bal(B), bB); assert.equal(await house(), 0n); assert.equal(db.T().gameSeat.length, 0); assert.equal(db.T().gameMatch.find((x) => String(x.id) === f7).status, "INVITED");
ok("a database failure half-way through starting rolled everything back: no wager taken, nobody seated, the challenge still open");
const okAgain = await svc.respond(db, B.uid, { matchId: f7, accept: true, requestId: rq() }); assert.ok(okAgain.started); ok("and the same challenge can then be accepted normally");
await svc.resign(db, B.uid, { matchId: f7 });

// ---------- declines, withdrawals, expiry
const f8 = (await ch(A, "Dayo", "LUDO", 0)).id; await svc.respond(db, D.uid, { matchId: f8, accept: false, requestId: rq() }); assert.equal(db.T().gameMatch.find((x) => String(x.id) === f8).status, "CANCELLED");
await rejects("accepting a declined challenge", () => svc.respond(db, D.uid, { matchId: f8, accept: true, requestId: rq() }), /no longer open/);
const f9 = (await ch(A, "Dayo", "LUDO", 0)).id; await svc.withdraw(db, A.uid, { matchId: f9 }); await rejects("accepting a withdrawn challenge", () => svc.respond(db, D.uid, { matchId: f9, accept: true, requestId: rq() }), /no longer open/);
const f10 = (await ch(A, "Dayo", "LUDO", 0)).id; db.T().gameMatch.find((x) => String(x.id) === f10).createdAt = new Date(Date.now() - 11 * 60_000);
await rejects("accepting a lapsed challenge", () => svc.respond(db, D.uid, { matchId: f10, accept: true, requestId: rq() }), /no longer open/);
ok("declined, withdrawn and lapsed challenges cannot be accepted, and held nothing");
const dupId = rq(); const x1 = await svc.challenge(db, A.uid, { to: "Dayo", game: "LUDO", stakeNaira: 0, requestId: dupId }), x2 = await svc.challenge(db, A.uid, { to: "Dayo", game: "LUDO", stakeNaira: 0, requestId: dupId }); assert.ok(x2.duplicate);
ok("the same challenge request sent twice made one challenge");

// ---------- every engine can be dealt and viewed through the service
for (const g of Object.keys(ENGINES)) { const id = (await ch(A, "Bola", g, 0)).id; await svc.respond(db, B.uid, { matchId: id, accept: true, requestId: rq() }); const v = (await svc.getMatch(db, A.uid, id)).match; assert.ok(v.board, g); assert.equal(v.game, g); await svc.resign(db, A.uid, { matchId: id }); }
ok("all seven games can be started, read and ended through the service");
assert.equal(await house(), 0n); assert.equal(await total(), START + adj, "money is conserved apart from what the test itself added or removed");
ok("final check: escrow is empty and the books balance");
console.log("\nAll game match checks passed");
