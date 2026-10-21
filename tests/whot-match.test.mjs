// tests/whot-match.test.mjs: a wagered Whot match played through the real match service (lib/games/matchService.js) against the in-memory database:
// the rival's hand never leaves the server, cheating moves are refused, the winner is paid the whole pool exactly once, and the books balance.
import { register } from "node:module";
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
register(new URL("./fixtures/games-loader.mjs", import.meta.url));
const svc = await import("../lib/games/matchService.js");
const { GameError } = await import("./fixtures/games-gameService-stub.mjs");
const W = await import("../lib/games/whot.js");

const db = makeDb(["character", "account", "ledgerEntry", "gameMatch", "gameQueue", "gameSeat", "notification", "actionLog", "block"], {
  unique: { gameSeat: ["characterId"], gameQueue: ["characterId"], ledgerEntry: ["idempotencyKey"], actionLog: ["characterId", "requestId"] },
  defaults: { gameMatch: { version: 0, turn: 0, turnDeadline: null, winnerSeat: null, result: null, reason: null, payoutKobo: 0n, drawOffer: null, rematch: null, rematchOfId: null, rids: [], startedAt: null, finishedAt: null }, gameQueue: {}, character: { jailedUntil: null, suspendedUntil: null, expelled: false, expelledUntil: null } },
  join: { character: (r, T) => r && ({ ...r, account: T.account.find((a) => a.characterId === r.id) ?? null }) },
});
db.$queryRaw = async () => [];
let chain = Promise.resolve(); const rawTx = db.$transaction;
db.$transaction = (fn) => { const run = chain.then(() => rawTx(fn)); chain = run.catch(() => {}); return run; };
db.account.upsert = async ({ where, create }) => (await db.account.findUnique({ where })) ?? db.account.create({ data: { id: "a_" + create.systemName, ...create } });
const pc = db.gameMatch.create; db.gameMatch.create = (a) => pc({ data: { createdAt: new Date(), ...a.data } });
const pq = db.gameQueue.create; db.gameQueue.create = (a) => pq({ data: { joinedAt: new Date(), ...a.data } });

let n = 0; const rq = () => "wq-" + String(++n).padStart(6, "0"), N = (x) => BigInt(x) * 100n, ok = (m) => console.log("OK  ", m);
async function player(name, naira) {
  const c = await db.character.create({ data: { id: "c_" + name, userId: "u_" + name, name, level: 100, hostel: "Awo" } });
  await db.account.create({ data: { id: "a_" + name, kind: "PLAYER", characterId: c.id, balance: N(naira) } });
  return { id: c.id, uid: "u_" + name };
}
const bal = async (p) => (await db.account.findUnique({ where: { characterId: p.id } })).balance;
const A = await player("Ada", 5_000), B = await player("Bola", 5_000);

const { id } = await svc.challenge(db, A.uid, { to: "Bola", game: "WHOT", stakeNaira: 1_000, requestId: rq() });
await svc.respond(db, B.uid, { matchId: id, accept: true, requestId: rq() });
assert.equal(await bal(A), N(4_000)); assert.equal(await bal(B), N(4_000)); ok("both ₦1,000 wagers are in escrow once the Whot match starts");

const mv = (p, action) => svc.move(db, p.uid, { matchId: id, action, requestId: rq() });
const read = async (p) => (await svc.getMatch(db, p.uid, id)).match;
let a = await read(A), b = await read(B);
assert.equal(a.board.hand.length, 6); assert.equal(b.board.hand.length, 6); assert.equal(a.board.counts[1 - a.seat], 6);
const stored = db.T().gameMatch[0].state, seeA = JSON.stringify(a), seeB = JSON.stringify(b);
for (const c of stored.hands[b.seat]) assert.ok(!seeA.includes(`"id":${c.id},"s"`) || a.board.hand.some((x) => x.id === c.id), "the rival's card leaked into the other player's view");
for (const c of stored.market) assert.ok(!seeA.includes(`"id":${c.id},"s"`) && !seeB.includes(`"id":${c.id},"s"`), "a market card leaked");
ok("each player is sent only their own hand: the rival's cards and the market order never leave the server");

const mover = a.yourTurn ? A : B, waiter = mover === A ? B : A, mine = (await read(mover)).board;
await assert.rejects(() => mv(waiter, { type: "draw" }), (e) => e instanceof GameError && /not your turn/.test(e.message)); ok("moving out of turn is refused");
const mySeat = (await read(mover)).seat, rivalCard = stored.hands[1 - mySeat][0].id;
await assert.rejects(() => mv(mover, { type: "play", card: rivalCard }), (e) => e instanceof GameError && /not in your hand/.test(e.message)); ok("playing a card from the rival's hand is refused");
await assert.rejects(() => mv(mover, { type: "win" }), (e) => e instanceof GameError); ok("a player cannot claim the win");
const bad = mine.hand.find((c) => !mine.playable.includes(c.id));
if (bad && mine.playable.length) { await assert.rejects(() => mv(mover, { type: "play", card: bad.id, shape: "star" }), (e) => e instanceof GameError); ok("an unplayable card is refused"); }

// play the rest with the computer's choices (always legal) until the match is over
let guard = 0, last;
while (guard++ < 1500) {
  const m = await read(A); if (m.status !== "ACTIVE") { last = m; break; }
  const p = m.yourTurn ? A : B, state = db.T().gameMatch[0].state;
  const move = W.chooseMove(state, p === A ? m.seat : 1 - m.seat, Math.random);
  const rid = rq(); const r1 = await svc.move(db, p.uid, { matchId: id, action: move, requestId: rid });
  const again = await svc.move(db, p.uid, { matchId: id, action: move, requestId: rid }); // the same request sent twice
  assert.ok(again.duplicate || again.over, "a repeated request is played once");
  if (r1.match.status !== "ACTIVE") { last = r1.match; break; }
}
assert.ok(last && last.status === "FINISHED", "the match finished"); ok(`the match ran to the end in ${guard} turns`);
const won = last.winnerSeat != null, winner = (await read(A)).outcome === "WON" ? A : (await read(B)).outcome === "WON" ? B : null;
if (winner) { const loser = winner === A ? B : A; assert.equal(await bal(winner), N(6_000)); assert.equal(await bal(loser), N(4_000)); ok("the winner was paid the whole ₦2,000 pool exactly once (₦6,000 against ₦4,000)"); }
else { assert.equal(await bal(A), N(5_000)); assert.equal(await bal(B), N(5_000)); ok("a drawn match returned both wagers"); }
const done = await read(A); assert.ok(done.board.opponentHand, "the final screen shows the rival's hand"); ok("when the match ends the rival's hand is revealed");
const after = await mv(A, { type: "draw" }); assert.ok(after.over && after.match.status === "FINISHED"); ok("no move is accepted after the match is over");
const a2 = await bal(A), b2 = await bal(B); assert.equal(a2 + b2, N(10_000)); ok("final check: the books balance");
console.log("\nAll Whot match checks passed.");
