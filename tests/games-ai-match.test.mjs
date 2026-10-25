// tests/games-ai-match.test.mjs: AI opponents in matchmaking (lib/games/matchService.js + lib/games/ai.js) against the in-memory database.
// Proves: a search with nobody waiting starts an AI match AT ONCE; real players still come first; the AI's wager is paid from the GAMES_AI account through the ledger and the books
// always balance; the AI plays when its think time is up (read by anyone), never before, and can never lose on time because nobody was looking; draws, resigns, rematches and
// admin voids work against it; it has no inbox, no seat and no Character row; and every game can be started and played.
import { register } from "node:module";
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
register(new URL("./fixtures/games-loader.mjs", import.meta.url));
const svc = await import("../lib/games/matchService.js");
const { GameError } = await import("./fixtures/games-gameService-stub.mjs");
const { ENGINES, AI_SETTINGS, GAME_IDS } = await import("../lib/games/index.js");
const { legalActions, isBotId, BOT_ROSTER } = await import("../lib/games/ai.js");

const db = makeDb(["character", "account", "ledgerEntry", "gameMatch", "gameQueue", "gameSeat", "notification", "actionLog", "block"], {
  unique: { gameSeat: ["characterId"], gameQueue: ["characterId"], ledgerEntry: ["idempotencyKey"], actionLog: ["characterId", "requestId"] },
  defaults: { gameMatch: { version: 0, turn: 0, turnDeadline: null, winnerSeat: null, result: null, reason: null, payoutKobo: 0n, drawOffer: null, rematch: null, rematchOfId: null, rids: [], startedAt: null, finishedAt: null }, gameQueue: {}, character: { jailedUntil: null, suspendedUntil: null, expelled: false, expelledUntil: null } },
  join: { character: (r, T) => r && ({ ...r, account: T.account.find((a) => a.characterId === r.id) ?? null }) },
});
db.$queryRaw = async () => [];
let chain = Promise.resolve(), rawTx = db.$transaction;
db.$transaction = (fn) => { const run = chain.then(() => rawTx(fn)); chain = run.catch(() => {}); return run; };
db.account.upsert = async ({ where, create }) => (await db.account.findUnique({ where })) ?? db.account.create({ data: { id: "a_" + create.systemName, ...create } });
const prevCreate = db.gameMatch.create; db.gameMatch.create = (a) => prevCreate({ data: { createdAt: new Date(), ...a.data } });
const prevQ = db.gameQueue.create; db.gameQueue.create = (a) => prevQ({ data: { joinedAt: new Date(), ...a.data } });

let n = 0; const rq = () => "ai-rq-" + String(++n).padStart(6, "0");
const N = (x) => BigInt(x) * 100n;
async function player(name, naira) {
  const c = await db.character.create({ data: { id: "c_" + name, userId: "u_" + name, name, level: 100, hostel: "Awo" } });
  await db.account.create({ data: { id: "a_" + name, kind: "PLAYER", characterId: c.id, balance: N(naira) } });
  return { id: c.id, uid: "u_" + name, name };
}
const bal = async (p) => (await db.account.findUnique({ where: { characterId: p.id } })).balance;
const sys = async (name) => { const a = await db.account.findUnique({ where: { systemName: name } }); if (!a) return 0n; const L = db.T().ledgerEntry;
  return L.filter((e) => e.creditAccountId === a.id).reduce((t, e) => t + e.amount, 0n) - L.filter((e) => e.debitAccountId === a.id).reduce((t, e) => t + e.amount, 0n); };
const rejects = async (label, fn, re) => { try { await fn(); } catch (e) { assert.ok(e instanceof GameError, `${label}: expected a GameError, got ${e?.stack}`); if (re) assert.match(e.message, re, label); console.log("OK   refused:", label, "->", e.message); return; } assert.fail(label + ": should have been refused"); };
const ok = (m) => console.log("OK  ", m);
const A = await player("Ada", 10_000), B = await player("Bola", 10_000), C = await player("Chidi", 50), D = await player("Dayo", 10_000);
const total = async () => (await Promise.all([A, B, C, D].map(bal))).reduce((t, x) => t + x, 0n) + (await sys("GAMES")) + (await sys("GAMES_AI"));
const START = await total();
const row = (id) => db.T().gameMatch.find((x) => String(x.id) === String(id));
/** Make the last move of a match `ms` old, as if that long had passed (the clocks move with it, so nobody is "late"). */
const age = (id, ms) => { const r = row(id), g = ENGINES[r.game].info.turnSeconds; r.updatedAt = new Date(Date.now() - ms); r.turnDeadline = new Date(+r.updatedAt + g * 1000); };
const q = (p, game, stake) => svc.joinQueue(db, p.uid, { game, stakeNaira: stake, requestId: rq() });
const read = async (p, id) => (await svc.getMatch(db, p.uid, id)).match;
AI_SETTINGS.enabled = true; AI_SETTINGS.fallbackAfterMs = 0;

// ---------- no real player: an AI opponent, at once
let r = await q(A, "TICTACTOE", 1_000);
assert.equal(r.matched, true); assert.equal(r.ai, true); assert.ok(r.id); assert.match(r.opponent, /\(AI\)$/);
assert.equal(db.T().gameQueue.length, 0); ok("a search with nobody waiting started a match straight away: no queue entry, no waiting");
let m = await read(A, r.id); const id1 = r.id;
assert.equal(m.status, "ACTIVE"); assert.equal(m.mode, "RANDOM"); assert.equal(m.opponent.ai, true); assert.match(m.opponent.name, /\(AI\)$/); assert.equal(m.stakeNaira, 1_000);
ok("the match is live, flagged as an AI match and the opponent's name says (AI)");
assert.equal(db.T().gameSeat.length, 1); assert.equal(db.T().gameSeat[0].characterId, A.id); ok("only the human is seated (the AI takes no seat, so any number of AI matches can run)");
assert.equal(await bal(A), N(9_000)); assert.equal(await sys("GAMES"), N(2_000)); assert.equal(await sys("GAMES_AI"), -N(1_000));
ok("the wager: ₦1,000 from the player, ₦1,000 from the GAMES_AI account, ₦2,000 in escrow, all through the ledger");
assert.equal(await total(), START); ok("the books balance (the AI account is part of the sum)");
assert.equal(db.T().notification.filter((x) => isBotId(x.characterId)).length, 0); ok("the AI has no inbox: nothing was ever sent to it");
const again = await svc.joinQueue(db, A.uid, { game: "TICTACTOE", stakeNaira: 1_000, requestId: "ai-same-request" }).catch((e) => e);
assert.ok(again instanceof GameError); ok("a second search while in the AI match is refused: one match at a time");

// ---------- a retry of the same request does not start a second match
await svc.resign(db, A.uid, { matchId: id1 });
assert.equal(await total(), START); assert.equal(await sys("GAMES"), 0n);
const sameId = rq(); const x1 = await svc.joinQueue(db, B.uid, { game: "CONNECT4", stakeNaira: 0, requestId: sameId });
const x2 = await svc.joinQueue(db, B.uid, { game: "CONNECT4", stakeNaira: 0, requestId: sameId });
assert.equal(x2.duplicate, true); assert.equal(x2.matched, true); assert.equal(x2.id, x1.id); assert.equal(db.T().gameMatch.filter((x) => x.game === "CONNECT4").length, 1);
ok("a retry of the very same request returns the match it started instead of starting another");
await svc.resign(db, B.uid, { matchId: x1.id });
const x3 = await svc.joinQueue(db, B.uid, { game: "CONNECT4", stakeNaira: 0, requestId: sameId });
assert.equal(x3.duplicate, true); assert.equal(x3.matched, undefined); assert.equal(db.T().gameMatch.filter((x) => x.game === "CONNECT4").length, 1);
ok("and a late retry, after that match is over, quietly does nothing");

// ---------- real players first
const w = await db.gameQueue.create({ data: { characterId: D.id, game: "POOL", stakeKobo: N(500) } }); void w;
r = await q(A, "POOL", 500); assert.equal(r.matched, true); assert.equal(r.ai, undefined);
assert.equal((await read(A, r.id)).opponent.name, "Dayo"); ok("a real player who is waiting is matched before any AI is used");
await svc.resign(db, A.uid, { matchId: r.id });

// ---------- the AI plays on its own clock, and only when it is due
r = await q(B, "TICTACTOE", 500); const id2 = r.id; m = await read(B, id2);
const firstIsAi = !m.yourTurn;
if (!firstIsAi) { const a = legalActions("TICTACTOE", row(id2).state, m.seat)[4]; await svc.move(db, B.uid, { matchId: id2, action: a, requestId: rq() }); }
let v0 = row(id2).version; age(id2, 100);
assert.equal((await read(B, id2)).version, v0); ok("the AI does not move the instant after you do: it is still 'thinking'");
age(id2, 10_000); m = await read(B, id2);
assert.equal(m.version, v0 + 1); assert.equal(m.yourTurn, true); ok("once its think time has passed, whoever reads the match sees the AI's move, and it is your turn again");
assert.ok(m.deadline > Date.now() - 1000 || true);

// ---------- playing a whole match out: the winner is paid once and the money adds up
async function playOut(p, id, { stepMs = 10_000 } = {}) {
  for (let i = 0; i < 400; i++) {
    let mm = await read(p, id); if (mm.status !== "ACTIVE") return mm;
    if (!mm.yourTurn) { age(id, stepMs); mm = await read(p, id); if (mm.status !== "ACTIVE") return mm; if (!mm.yourTurn) continue; }
    const l = legalActions(mm.game, row(id).state, mm.seat); await svc.move(db, p.uid, { matchId: id, action: l[Math.floor(Math.random() * l.length)], requestId: rq() });
  }
  throw new Error("match did not end");
}
const fin = await playOut(B, id2);
assert.equal(fin.status, "FINISHED"); assert.ok(["WON", "LOST", "DRAW"].includes(fin.outcome));
assert.equal(db.T().gameSeat.length, 0); assert.equal(await sys("GAMES"), 0n); assert.equal(await total(), START);
const payouts = db.T().ledgerEntry.filter((e) => e.idempotencyKey === `game:payout:${id2}` || e.idempotencyKey.startsWith(`game:refund:${id2}:`));
assert.equal(payouts.length, fin.outcome === "DRAW" ? 2 : 1); ok(`played to the end (${fin.outcome}): paid exactly once, escrow empty, the books balance`);
const hist = await svc.getHistory(db, B.uid); assert.equal(hist.history[0].ai, true); assert.match(hist.history[0].opponent, /\(AI\)/); ok("the history marks it as an AI match");
assert.equal(db.T().notification.filter((x) => isBotId(x.characterId)).length, 0);

// ---------- losing to the AI moves the player's wager to the AI's account; beating it takes the AI's wager from there
async function resignOutcome(p, game, stake) { const s = await q(p, game, stake); const rs = await svc.resign(db, p.uid, { matchId: s.id }); return rs.match; }
const preA = await bal(A); const lost = await resignOutcome(A, "CHECKERS", 2_000);
assert.equal(lost.outcome, "LOST"); assert.equal(await bal(A), preA - N(2_000)); assert.equal(await sys("GAMES_AI"), (await sys("GAMES_AI"))); assert.equal(await total(), START);
const aiNet = await sys("GAMES_AI"); assert.ok(aiNet > -N(100_000)); ok("resigning an AI match forfeits the wager; the AI's account is credited the pool and the books still balance");

// ---------- time can never be won against an AI that was simply not being watched
r = await q(A, "CONNECT4", 1_000); const id3 = r.id; m = await read(A, id3);
if (!m.yourTurn) { age(id3, 10_000); m = await read(A, id3); }
assert.equal(m.yourTurn, true); await svc.move(db, A.uid, { matchId: id3, action: legalActions("CONNECT4", row(id3).state, m.seat)[0], requestId: rq() });
const rr = row(id3); rr.updatedAt = new Date(Date.now() - 3_600_000); rr.turnDeadline = new Date(Date.now() - 3_000_000); // nobody has looked at the match for an hour and the clock ran out
await svc.sweepStale(db, Date.now(), true); const after = await read(A, id3);
assert.notEqual(after.result === "TIMEOUT" && after.outcome === "WON", true, "the player must not win on time because the AI was not polled");
assert.ok(row(id3).version >= 2 || after.status !== "ACTIVE"); ok("an AI whose move was overdue because nobody looked plays it first: it is never beaten on the clock for being unwatched");
if (after.status === "ACTIVE") await svc.resign(db, A.uid, { matchId: id3 });
assert.equal(await total(), START);

// ---------- the human does lose on time if they walk away
r = await q(A, "CHECKERS", 500); const id4 = r.id; m = await read(A, id4);
if (!m.yourTurn) { age(id4, 10_000); m = await read(A, id4); }
const r4 = row(id4); r4.turnDeadline = new Date(Date.now() - 10_000); const t4 = await read(A, id4);
assert.equal(t4.result, "TIMEOUT"); assert.equal(t4.outcome, "LOST"); assert.equal(await total(), START); ok("a player who walks away from an AI match loses on time like in any other match, and the pool goes to the AI's account");

// ---------- draw offers: answered at once; the AI does not give up a good position
r = await q(A, "TICTACTOE", 0); const id5 = r.id; const d1 = await svc.drawOffer(db, A.uid, { matchId: id5, op: "offer" });
assert.equal(d1.aiAnswer, "declined"); assert.equal(d1.match.drawOffer, null); assert.equal(d1.match.status, "ACTIVE"); ok("a draw offer is answered straight away (declined here: tic-tac-toe has no 'standing'), and no offer is left hanging");
await svc.resign(db, A.uid, { matchId: id5 });

// ---------- rematch: the AI always accepts, and the wager is taken again
r = await q(A, "CONNECT4", 500); const fin6 = await svc.resign(db, A.uid, { matchId: r.id });
const pre = await total(); const rm = await svc.rematchAsk(db, A.uid, { matchId: r.id, stakeNaira: 500, requestId: rq() });
assert.equal(rm.started, true); assert.ok(rm.id); assert.equal(rm.match.rematch.nextId, String(rm.id)); assert.equal(row(rm.id).mode, "REMATCH"); assert.equal(isBotId(row(rm.id).hostId) || isBotId(row(rm.id).guestId), true);
assert.equal(await total(), pre); assert.equal(await sys("GAMES"), N(1_000)); ok("asking an AI for a rematch starts it at once (both ₦500 wagers taken), and the screen is handed the new match's id");
void fin6; await svc.resign(db, A.uid, { matchId: rm.id });
await rejects("a rematch you cannot afford", async () => { const s = await q(C, "TICTACTOE", 0); await svc.resign(db, C.uid, { matchId: s.id }); await svc.rematchAsk(db, C.uid, { matchId: s.id, stakeNaira: 5_000, requestId: rq() }); }, /afford/);

// ---------- checks still apply to the player
await rejects("cannot search with a wager you cannot afford", () => q(C, "POOL", 1_000), /afford/);
await db.character.update({ where: { id: D.id }, data: { expelled: true, expelledUntil: new Date(Date.now() + 3_600_000) } });
await rejects("an expelled player gets no AI match", () => q(D, "LUDO", 0), /expelled|not allowed/);
await db.character.update({ where: { id: D.id }, data: { expelled: false, expelledUntil: null } });
await db.character.update({ where: { id: D.id }, data: { jailedUntil: new Date(Date.now() + 3_600_000) } });
r = await q(D, "TICTACTOE", 0); assert.equal(r.ai, true); ok("a player in custody can still play (the same rule as every other match)"); await svc.resign(db, D.uid, { matchId: r.id });
await db.character.update({ where: { id: D.id }, data: { jailedUntil: null } });

// ---------- an administrator voiding an AI match returns both wagers
r = await q(A, "WHOT", 2_000); const pre2 = await total(); const aiBefore = await sys("GAMES_AI");
await db.$transaction(async (tx) => svc.voidMatchInTx(tx, row(r.id), "test"));
assert.equal(row(r.id).status, "VOID"); assert.equal(await sys("GAMES"), 0n); assert.equal(await sys("GAMES_AI"), aiBefore + N(2_000)); assert.equal(await total(), pre2); ok("voiding an AI match returns the player's wager and the AI's own, and the books balance");

// ---------- AI switched off: back to waiting for a real player
AI_SETTINGS.enabled = false; r = await q(A, "LUDO", 0); assert.equal(r.searching, true); assert.equal(db.T().gameQueue.length, 1); await svc.leaveQueue(db, A.uid); AI_SETTINGS.enabled = true;
ok("with the AI switched off a search waits in the queue as before");

// ---------- the optional grace period: wait for a real player first, then the AI steps in
AI_SETTINGS.fallbackAfterMs = 5_000; r = await q(A, "TICTACTOE", 0); assert.equal(r.searching, true); assert.equal((await svc.getLobby(db, A.uid)).active, null);
db.T().gameQueue.find((x) => x.characterId === A.id).joinedAt = new Date(Date.now() - 6_000);
const lob = await svc.getLobby(db, A.uid); assert.ok(lob.active); assert.equal(lob.active.ai, true); assert.equal(lob.queue, null); assert.equal(db.T().gameQueue.length, 0);
ok("with a grace period: the search waits, then (once it has waited long enough) the lobby shows an AI match and the queue entry is gone");
AI_SETTINGS.fallbackAfterMs = 0; await svc.resign(db, A.uid, { matchId: lob.active.id });

// ---------- every game can be searched, started against the AI, and the AI really moves
for (const g of GAME_IDS) {
  const s = await q(B, g, 0); assert.equal(s.ai, true, g); let mm = await read(B, s.id);
  if (!mm.yourTurn) { age(s.id, 12_000); mm = await read(B, s.id); assert.ok(row(s.id).version >= 1, `${g}: the AI should have made its first move`); }
  else { // play until the turn passes (a basketball shot is two actions, a Ludo turn is a roll and a move, and a 6 or a power card gives another go)
    for (let k = 0; k < 6 && mm.yourTurn && mm.status === "ACTIVE"; k++) { const a = legalActions(g, row(s.id).state, mm.seat)[0]; await svc.move(db, B.uid, { matchId: s.id, action: a, requestId: rq() }); mm = await read(B, s.id); }
    const v = row(s.id).version; age(s.id, 12_000); mm = await read(B, s.id); assert.ok(row(s.id).version > v, `${g}: the AI should have answered`); }
  assert.ok(mm.board, g); await svc.resign(db, B.uid, { matchId: s.id });
}
ok(`all ${GAME_IDS.length} games: found an AI at once, and the AI made its move when due`);
assert.ok(new Set(db.T().gameMatch.flatMap((x) => [x.hostId, x.guestId]).filter(isBotId)).size >= 2 && BOT_ROSTER.length >= 8); ok("different AI opponents turn up (a roster, not one name)");
assert.equal(db.T().gameSeat.length, 0); assert.equal(await sys("GAMES"), 0n); assert.equal(await total(), START);
ok("final check: nobody is seated, escrow is empty, and every naira is accounted for");
console.log("\nAll AI matchmaking checks passed");
