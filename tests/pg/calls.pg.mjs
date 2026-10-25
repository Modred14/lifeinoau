// tests/pg/calls.pg.mjs: the Calls app against a real PostgreSQL database (see tests/pg/bankHarness.mjs for how to run it).
import { db, reset, player, rq, balance, naira, denied, books, assert, ok, done } from "./bankHarness.mjs";
import { callParent, dial, answer, end, ask, decide, pollCalls, callHistory, callHome, findPeople } from "../../lib/callService.js";
import { sendMoney } from "../../lib/gameService.js";
import { PLAYER_CALL, allowanceFor } from "../../lib/callRules.js";

await reset();
const now = () => new Date();
const online = (p) => db.phoneLine.upsert({ where: { characterId: p.id }, create: { characterId: p.id, seenAt: now() }, update: { seenAt: now() } });
const uncool = (p) => db.actionLog.updateMany({ where: { characterId: p.id, action: "transfer" }, data: { createdAt: new Date(Date.now() - 3_600_000) } }); // the one-minute transfer cooldown has passed
const call = (id) => db.phoneCall.findUnique({ where: { id } });
const ledgerOf = (callId) => db.ledgerEntry.findMany({ where: { OR: [{ idempotencyKey: { contains: callId } }] } });
const backdate = (id, data) => db.phoneCall.update({ where: { id }, data });

// =====================================================================================================
// CALLING HOME
// =====================================================================================================
const seen = new Map(); let gifted = 0;
for (let i = 0; i < 400 && seen.size < 5; i++) {
  const cls = ["LAPO", "MAPO", "NEPO"][i % 3];
  const p = await player(`Kid${i}`, { balanceNaira: 1_000, char: { class: cls, lastParentCallWeek: 0, happiness: 50 } });
  const before = await balance(p), r = await callParent(db, p.uid, { requestId: rq() });
  assert.equal(r.ok, true); const c = r.call, o = c.outcome; seen.set(o, (seen.get(o) ?? 0) + 1);
  const after = await balance(p), ch = await db.character.findUnique({ where: { id: p.id } });
  assert.ok(["MUMMY", "DADDY"].includes(c.peer.toUpperCase()), "the parent is Mummy or Daddy");
  assert.equal(c.kind, "PARENT"); assert.ok(c.line && c.line.length > 5, "the parent says something");
  if (o === "GIVEN") {
    gifted++; const gift = BigInt(r.giftKobo), allow = allowanceFor(cls);
    assert.ok(gift > 0n && gift % 10_000n === 0n, "a whole ₦100 multiple");
    assert.ok(gift >= (allow * 5n) / 100n - 9_999n && gift <= (allow * 20n) / 100n, `gift ${gift} is 5%..20% of the allowance ${allow}`);
    assert.equal(after - before, gift, "the player's balance rose by exactly the gift, immediately");
    assert.equal(BigInt(r.balanceKobo), after, "the response carries the new balance");
    const le = await db.ledgerEntry.findUnique({ where: { idempotencyKey: `gift:call:${c.id}` } });
    assert.equal(le.amount, gift); assert.equal(le.memo, "Gift from parent");
    assert.equal(ch.happiness, 53); assert.equal(ch.lastParentCallWeek, 1);
  } else {
    assert.equal(after, before, `${o}: no money moves`); assert.equal(r.giftKobo, "0");
    if (o === "NO_ANSWER" || o === "CALL_DECLINED") { assert.equal(ch.lastParentCallWeek, 0, "an unanswered call is not the weekly call home"); assert.equal(c.answeredAt, null); }
    else { assert.equal(ch.lastParentCallWeek, 1, "a parent who picked up counts as calling home"); assert.ok(c.answeredAt); }
    if (o === "REFUSED") assert.equal(ch.happiness, 49); if (o === "LATER") assert.equal(ch.happiness, 51);
  }
  assert.equal(c.status, { NO_ANSWER: "MISSED", CALL_DECLINED: "DECLINED" }[o] ?? "ENDED");
}
assert.deepEqual([...seen.keys()].sort(), ["CALL_DECLINED", "GIVEN", "LATER", "NO_ANSWER", "REFUSED"]);
ok("calling home: every outcome occurs and each one settles correctly", JSON.stringify(Object.fromEntries(seen)));
await books();

const mum = await player("Mum Test", { balanceNaira: 1_000, char: { class: "MAPO", lastParentCallWeek: 0 } });
const rid = rq(), first = await callParent(db, mum.uid, { requestId: rid });
const replay = await callParent(db, mum.uid, { requestId: rid });
assert.equal(replay.replayed, true); assert.equal(replay.call.id, first.call.id);
assert.equal(await db.phoneCall.count({ where: { callerId: mum.id } }), 1);
ok("the same request id returns the same call (no second call, no second gift)");
await denied("calling home again straight away", () => callParent(db, mum.uid, { requestId: rq() }), /not free right now\. Try calling again in/i, 429);
const parallel = await Promise.allSettled(Array.from({ length: 8 }, () => callParent(db, mum.uid, { requestId: rq() })));
assert.equal(parallel.filter((x) => x.status === "fulfilled").length, 0); assert.equal(await db.phoneCall.count({ where: { callerId: mum.id } }), 1);
ok("8 simultaneous calls home during the cooldown: none get through");
await db.phoneCall.update({ where: { id: first.call.id }, data: { createdAt: new Date(Date.now() - 24 * 3_600_000) } });
const later = await callParent(db, mum.uid, { requestId: rq() }); assert.equal(later.ok, true);
ok("after the cooldown the parent can be called again");

// the weekly cap: gifts from home this week (from any road) never pass 60% of the allowance
const cap = await player("Capped", { balanceNaira: 100, char: { class: "LAPO", lastParentCallWeek: 0 } });
const parents = await db.account.findUnique({ where: { systemName: "PARENTS" } });
const { transferInTx } = await import("../../lib/ledger.js");
await transferInTx(db, { fromId: parents.id, toId: cap.accountId, amount: naira(17_700), memo: "Gift from parent", key: `gift:${cap.id}:1`, week: 1 }); // the Home button's gift: ₦17,700 of the ₦18,000 cap
let maxGiven = 0n, capTrials = 0;
for (let i = 0; i < 60; i++) {
  const q = await player(`CapT${i}`, { balanceNaira: 100, char: { class: "LAPO" } });
  await transferInTx(db, { fromId: parents.id, toId: q.accountId, amount: naira(17_700), memo: "Gift from parent", key: `gift:${q.id}:1`, week: 1 });
  const r = await callParent(db, q.uid, { requestId: rq() }); capTrials++;
  assert.notEqual(r.call.outcome, "GIVEN", "no gift fits in ₦300 of room"); maxGiven = BigInt(r.giftKobo) > maxGiven ? BigInt(r.giftKobo) : maxGiven;
}
assert.equal(maxGiven, 0n); ok(`the weekly gift cap holds (${capTrials} calls, none gave money past 60% of the allowance)`);
const spam = await player("Spammer", { balanceNaira: 100 });
for (let i = 0; i < 6; i++) await db.phoneCall.create({ data: { kind: "PARENT", callerId: spam.id, callerName: "Spammer", calleeName: "Mummy", requestId: rq(), status: "MISSED", endReason: "NO_ANSWER", outcome: "NO_ANSWER", createdAt: new Date(Date.now() - 86_400_000), ringUntil: now(), gameWeek: 1, endedAt: now() } });
await denied("a seventh call home in one week", () => callParent(db, spam.uid, { requestId: rq() }), /called home a lot this week/i, 429);
await denied("calling home without a request id", () => callParent(db, spam.uid, {}), /requestId/i);
const home = await callHome(db, mum.uid); assert.ok(home.parent.name && home.parent.callsThisWeek >= 2 && "waitMs" in home.parent);
ok("limits are enforced and the Calls home screen reports the parent's state");

// =====================================================================================================
// CALLING A PLAYER FOR MONEY
// =====================================================================================================
const ada = await player("Ada", { balanceNaira: 2_000 }), ben = await player("Ben", { balanceNaira: 100_000 }), cy = await player("Cy", { balanceNaira: 50_000 });
const stateOf = async (p) => (await pollCalls(db, p.uid));

// offline players
const off = await dial(db, ada.uid, { to: "Ben", requestId: rq() });
assert.equal(off.ok, false); assert.equal(off.unavailable, true); assert.equal(off.reason, "offline"); assert.match(off.message, /offline.*message/i);
assert.equal(await db.phoneCall.count({ where: { callerId: ada.id, kind: "PLAYER" } }), 0, "no call is made to an offline player");
assert.equal((await db.notification.findMany({ where: { characterId: ben.id, body: /Ada tried to call/ } })).length, 1);
await dial(db, ada.uid, { to: "Ben", requestId: rq() });
assert.equal((await db.notification.findMany({ where: { characterId: ben.id, body: /Ada tried to call/ } })).length, 1, "one missed-call note per ten minutes");
ok("an offline player cannot be rung: a clear 'unavailable' answer, one missed-call note, no call row");
await online(ben);
await denied("calling yourself", () => dial(db, ada.uid, { to: "ada", requestId: rq() }), /yourself/i);
await denied("an unknown player", () => dial(db, ada.uid, { to: "Nobody Here", requestId: rq() }), /No player/i, 404);
await db.block.create({ data: { blockerId: ben.id, blockedId: ada.id } });
await denied("a player who blocked you", () => dial(db, ada.uid, { to: "Ben", requestId: rq() }), /cannot call/i, 403);
await db.block.deleteMany({});
ok("self, unknown and blocked players cannot be rung");

// ringing
const r1 = rq(), d1 = await dial(db, ada.uid, { to: "Ben", requestId: r1 });
assert.equal(d1.ok, true); assert.equal(d1.call.status, "RINGING"); assert.equal(d1.call.role, "caller"); assert.equal(d1.call.peer, "Ben");
assert.equal((await dial(db, ada.uid, { to: "Ben", requestId: r1 })).call.id, d1.call.id); assert.equal(await db.phoneCall.count({ where: { callerId: ada.id, kind: "PLAYER" } }), 1);
ok("a call rings, and dialling again with the same request id is the same call");
assert.equal((await stateOf(ada)).active.ringingAt, null, "until Ben's phone has shown it, Ada's screen says Calling");
const benView = await stateOf(ben);
assert.equal(benView.active.status, "RINGING"); assert.equal(benView.active.role, "callee"); assert.equal(benView.active.peer, "Ada");
assert.ok((await stateOf(ada)).active.ringingAt, "after Ben's phone shows it, Ada's screen says Ringing");
ok("the callee's phone shows an incoming call, then the caller's screen moves from Calling to Ringing");
await online(cy); await online(ada);
const busy = await dial(db, cy.uid, { to: "Ben", requestId: rq() }); assert.equal(busy.reason, "busy");
await denied("dialling while you are on a call", () => dial(db, ada.uid, { to: "Cy", requestId: rq() }), /already on a call/i, 409);
ok("a player already ringing someone is busy, and a caller cannot start a second call");
await denied("the caller answering their own call", () => answer(db, ada.uid, { callId: d1.call.id }), /Only the person being called/i, 403);
await denied("a stranger touching the call", () => answer(db, cy.uid, { callId: d1.call.id }), /not found/i, 404);
await denied("a stranger hanging up", () => end(db, cy.uid, { callId: d1.call.id }), /not found/i, 404);
await denied("a made-up call id", () => answer(db, ben.uid, { callId: "x'; DROP TABLE" }), /not found/i, 404);
ok("only the two people on a call can act on it, and only the callee can answer");

// answered: ask, consent, payment
const a1 = await answer(db, ben.uid, { callId: d1.call.id });
assert.equal(a1.call.status, "ANSWERED"); assert.ok(a1.call.answeredAt);
await denied("asking for less than the minimum", () => ask(db, ada.uid, { callId: d1.call.id, amountNaira: 50 }), /between/i);
await denied("asking for more than the maximum", () => ask(db, ada.uid, { callId: d1.call.id, amountNaira: 6_000_000 }), /between/i);
await denied("asking for a fraction", () => ask(db, ada.uid, { callId: d1.call.id, amountNaira: "10.5" }), /whole/i);
await denied("the callee asking the caller for money", () => ask(db, ben.uid, { callId: d1.call.id, amountNaira: 500 }), /Only the person who made the call/i, 403);
const asked = await ask(db, ada.uid, { callId: d1.call.id, amountNaira: 5_000 });
assert.equal(asked.call.askStatus, "PENDING"); assert.equal(asked.call.askKobo, naira(5_000).toString());
assert.equal(await balance(ada), naira(2_000)); assert.equal(await balance(ben), naira(100_000)); assert.equal((await ledgerOf(d1.call.id)).length, 0);
ok("asking for money only records the question: nobody's balance moves");
const seenByBen = (await stateOf(ben)).active;
assert.equal(seenByBen.askStatus, "PENDING"); assert.equal(seenByBen.costKobo, naira(5_100).toString(), "Ben is shown the amount plus the 2% fee before he approves");
await denied("asking twice on one call", async () => { const r = await ask(db, ada.uid, { callId: d1.call.id, amountNaira: 100 }); if (r.ok === false) throw new Error(r.message); }, /already asked/i);
await denied("the caller approving their own request", () => decide(db, ada.uid, { callId: d1.call.id, approve: true }), /Only the person who was called/i, 403);
assert.equal(await balance(ada), naira(2_000)); assert.equal(await balance(ben), naira(100_000));
ok("the caller cannot approve their own request: no money moves without the callee");
const paid = await decide(db, ben.uid, { callId: d1.call.id, approve: true });
assert.equal(paid.ok, true); assert.equal(paid.call.askStatus, "APPROVED"); assert.equal(paid.call.status, "ENDED"); assert.equal(paid.call.endReason, "PAID");
assert.equal(await balance(ada), naira(7_000)); assert.equal(await balance(ben), naira(100_000 - 5_100));
const fee = await db.ledgerEntry.findFirst({ where: { idempotencyKey: `fee:${ben.id}:call-${d1.call.id}` } }); assert.equal(fee.amount, naira(100));
const final = await call(d1.call.id); assert.equal(final.paidKobo, naira(5_000)); assert.equal(final.feeKobo, naira(100));
assert.ok((await db.notification.findMany({ where: { characterId: ada.id, kind: "MONEY" } })).some((n) => /Ben sent you ₦5,000/.test(n.body)));
await books();
ok("approval pays: Ada +₦5,000, Ben -₦5,100 (the ₦100 fee goes to the world), both told, books balance");
assert.equal((await stateOf(ada)).last.askStatus, "APPROVED"); assert.equal((await stateOf(ben)).last.paidKobo, naira(5_000).toString());
const hs = await callHistory(db, ada.uid, {}); assert.ok(hs.calls.find((x) => x.id === d1.call.id && x.direction === "outgoing" && x.paidKobo === naira(5_000).toString()));
assert.ok((await callHistory(db, ben.uid, {})).calls.find((x) => x.id === d1.call.id && x.direction === "incoming"));
ok("both players see the result, and the call is in each one's history with its direction");
// the payment is a normal transfer in everyone's statement
const { getHistory } = await import("../../lib/bankService.js");
assert.equal((await getHistory(db, ada.uid, { filter: "transfers" })).rows[0].title, "Received from Ben");
assert.equal((await getHistory(db, ben.uid, { filter: "transfers" })).rows[0].detail, "call request");
ok("the Bank statement shows the approved request as an ordinary transfer");

// the transfer cooldown applies to approved requests, and the request stays open
const d2 = await dial(db, cy.uid, { to: "Ben", requestId: rq() }); await answer(db, ben.uid, { callId: d2.call.id }); await ask(db, cy.uid, { callId: d2.call.id, amountNaira: 1_000 });
const wait = await decide(db, ben.uid, { callId: d2.call.id, approve: true });
assert.equal(wait.ok, false); assert.match(wait.message, /wait \d+ seconds before sending money again/i); assert.equal((await call(d2.call.id)).askStatus, "PENDING");
await assert.rejects(() => sendMoney(db, ben.uid, { to: "Cy", amountNaira: 100, requestId: rq() }), /wait \d+ seconds/i);
ok("an approval obeys the one-minute transfer cooldown, and the request stays open meanwhile");
await uncool(ben);
const ok2 = await decide(db, ben.uid, { callId: d2.call.id, approve: true }); assert.equal(ok2.ok, true); assert.equal(await balance(cy), naira(51_000));
ok("once the cooldown has passed the same request can be approved");

// rejection and the cooldown after it
const d3 = await dial(db, ada.uid, { to: "Ben", requestId: rq() }); await answer(db, ben.uid, { callId: d3.call.id }); await ask(db, ada.uid, { callId: d3.call.id, amountNaira: 900 });
const before3 = [await balance(ada), await balance(ben)];
const rej = await decide(db, ben.uid, { callId: d3.call.id, approve: false });
assert.equal(rej.call.askStatus, "REJECTED"); assert.equal(rej.call.status, "ENDED"); assert.deepEqual([await balance(ada), await balance(ben)], before3);
await denied("ringing someone who just turned you down", () => dial(db, ada.uid, { to: "Ben", requestId: rq() }), /not taking your calls right now\. Try again in/i, 429);
ok("a rejected request moves nothing and the caller must wait before asking that player again");

// insufficient funds on the approving side
const poor = await player("Poor", { balanceNaira: 1_000 }); await online(poor);
const d4 = await dial(db, ada.uid, { to: "Poor", requestId: rq() }); await answer(db, poor.uid, { callId: d4.call.id }); await ask(db, ada.uid, { callId: d4.call.id, amountNaira: 1_000 }); // 1,000 + 2% fee > 1,000
const fa = await decide(db, poor.uid, { callId: d4.call.id, approve: true });
assert.equal(fa.ok, false); assert.equal(fa.failed, true); assert.match(fa.message, /cannot afford ₦1,000 plus the ₦20 fee/i);
assert.equal(await balance(poor), naira(1_000)); const failed = await call(d4.call.id); assert.equal(failed.askStatus, "FAILED"); assert.equal(failed.status, "ENDED");
const adaView = (await stateOf(ada)).last; assert.equal(adaView.askStatus, "FAILED"); assert.ok(!JSON.stringify(adaView).includes("afford"), "the caller is never told how much the other player has");
await books(); ok("not enough money to cover the amount and fee: a clear refusal to the callee, nothing moves, and the caller learns nothing about their balance");

// declining, cancelling and timing out
await online(ben); await online(ada); await db.phoneCall.updateMany({ where: { kind: "PLAYER", status: { in: ["RINGING", "ANSWERED"] } }, data: { status: "ENDED", endedAt: now() } });
await db.phoneCall.deleteMany({ where: { callerId: cy.id } }); await db.phoneCall.updateMany({ where: { callerId: ada.id }, data: { createdAt: new Date(Date.now() - 86_400_000) } });
const d5 = await dial(db, cy.uid, { to: "Ben", requestId: rq() }); await stateOf(ben);
const dc = await end(db, ben.uid, { callId: d5.call.id }); assert.equal(dc.call.status, "DECLINED");
assert.equal((await stateOf(cy)).last.status, "DECLINED"); assert.equal((await stateOf(ben)).active, null);
ok("the callee can decline, and the caller is told");
const d6 = await dial(db, cy.uid, { to: "Ben", requestId: rq() }).catch((e) => e); // within the redial wait after a decline
assert.match(String(d6.message), /not taking your calls right now/i);
await db.phoneCall.updateMany({ where: { callerId: cy.id }, data: { createdAt: new Date(Date.now() - 86_400_000), endedAt: new Date(Date.now() - 86_400_000) } });
const d7 = await dial(db, cy.uid, { to: "Ben", requestId: rq() }); const cn = await end(db, cy.uid, { callId: d7.call.id }); assert.equal(cn.call.status, "CANCELLED");
assert.equal((await stateOf(ben)).active, null); ok("the caller can cancel a ringing call");
await db.phoneCall.updateMany({ where: { callerId: cy.id }, data: { createdAt: new Date(Date.now() - 86_400_000), endedAt: new Date(Date.now() - 86_400_000) } });
const d8 = await dial(db, cy.uid, { to: "Ben", requestId: rq() }); await backdate(d8.call.id, { ringUntil: new Date(Date.now() - 1_000) });
assert.equal((await stateOf(ben)).active, null); const missed = await call(d8.call.id); assert.equal(missed.status, "MISSED"); assert.equal(missed.endReason, "NO_ANSWER");
assert.equal((await db.notification.findMany({ where: { characterId: ben.id, body: "Missed call from Cy." } })).length, 1);
assert.equal((await stateOf(cy)).last.status, "MISSED"); await stateOf(cy);
assert.equal((await db.notification.findMany({ where: { characterId: ben.id, body: "Missed call from Cy." } })).length, 1, "settled exactly once even if both sides look");
await denied("answering a call that rang out", () => answer(db, ben.uid, { callId: d8.call.id }).then((r) => { if (r.ok === false) throw new Error(r.message); }), /missed|ended/i);
ok("an unanswered call becomes a missed call by itself: a note for the callee, once, whoever looks first");
await db.phoneCall.updateMany({ where: { callerId: cy.id }, data: { createdAt: new Date(Date.now() - 86_400_000), endedAt: new Date(Date.now() - 86_400_000) } });
const d9 = await dial(db, cy.uid, { to: "Ben", requestId: rq() }); await answer(db, ben.uid, { callId: d9.call.id }); await ask(db, cy.uid, { callId: d9.call.id, amountNaira: 700 });
await backdate(d9.call.id, { askUntil: new Date(Date.now() - 1_000) });
const late = await decide(db, ben.uid, { callId: d9.call.id, approve: true });
assert.equal(late.ok, false); assert.match(late.message, /ran out of time/i); assert.equal((await call(d9.call.id)).askStatus, "EXPIRED"); assert.equal(await balance(cy), naira(51_000));
ok("a request nobody answered in time expires, and approving it afterwards moves nothing");
await db.phoneCall.updateMany({ where: { callerId: cy.id }, data: { createdAt: new Date(Date.now() - 86_400_000), endedAt: new Date(Date.now() - 86_400_000) } });
const d10 = await dial(db, cy.uid, { to: "Ben", requestId: rq() }); await answer(db, ben.uid, { callId: d10.call.id }); await backdate(d10.call.id, { idleUntil: new Date(Date.now() - 1_000) });
await stateOf(cy); assert.equal((await call(d10.call.id)).endReason, "TIMEOUT"); ok("an answered call nobody asks anything on hangs up by itself");

// races
await db.phoneCall.updateMany({ where: { kind: "PLAYER" }, data: { createdAt: new Date(Date.now() - 86_400_000), status: "ENDED", endedAt: new Date(Date.now() - 86_400_000) } }); await online(ben); await online(ada); await online(cy);
const rush = await Promise.allSettled(Array.from({ length: 8 }, () => dial(db, ada.uid, { to: "Ben", requestId: rq() })));
const connected = rush.filter((x) => x.status === "fulfilled" && x.value.ok);
assert.equal(connected.length, 1, "exactly one of 8 simultaneous dials connects"); assert.equal(await db.phoneCall.count({ where: { callerId: ada.id, status: "RINGING" } }), 1);
const both = await Promise.allSettled([dial(db, cy.uid, { to: "Ben", requestId: rq() }), dial(db, cy.uid, { to: "Ada", requestId: rq() })]);
assert.ok(both.filter((x) => x.status === "fulfilled" && x.value.ok).length <= 1, "one caller cannot be on two calls");
ok("8 simultaneous dials make exactly one call; one player cannot ring two people at once");
const x1 = connected[0].value.call.id; await answer(db, ben.uid, { callId: x1 }); await ask(db, ada.uid, { callId: x1, amountNaira: 3_000 }); await uncool(ben);
const bBefore = await balance(ben), aBefore = await balance(ada);
const approvals = await Promise.allSettled(Array.from({ length: 6 }, () => decide(db, ben.uid, { callId: x1, approve: true })));
assert.equal(approvals.filter((x) => x.status === "fulfilled" && x.value.ok).length, 1, "exactly one approval pays");
assert.equal(await balance(ada) - aBefore, naira(3_000)); assert.equal(bBefore - await balance(ben), naira(3_060));
assert.equal(await db.ledgerEntry.count({ where: { idempotencyKey: `p2p:${ben.id}:call-${x1}` } }), 1); await books();
ok("6 simultaneous approvals pay exactly once");
await db.phoneCall.updateMany({ where: { kind: "PLAYER" }, data: { createdAt: new Date(Date.now() - 86_400_000), status: "ENDED", endedAt: new Date(Date.now() - 86_400_000), askAt: new Date(Date.now() - 2 * 86_400_000) } }); await uncool(ben); // earlier asks are now more than a day old
const x2 = (await dial(db, ada.uid, { to: "Ben", requestId: rq() })).call.id; await answer(db, ben.uid, { callId: x2 }); await ask(db, ada.uid, { callId: x2, amountNaira: 2_000 });
const b2 = await balance(ben), a2 = await balance(ada);
await Promise.allSettled([decide(db, ben.uid, { callId: x2, approve: true }), end(db, ada.uid, { callId: x2 }), end(db, ben.uid, { callId: x2 })]);
const fin = await call(x2), moved = (await balance(ada)) - a2;
assert.equal(fin.status, "ENDED"); assert.ok(moved === 0n || moved === naira(2_000), "never a half payment");
assert.equal(moved === naira(2_000), fin.askStatus === "APPROVED", "the money moved exactly when the call says it was approved"); await books();
ok(`approve racing two hang-ups is consistent (${fin.askStatus}, ${moved === 0n ? "no money" : "₦2,000 paid"})`);

// daily asking limit
const spamAsk = await player("Asker", { balanceNaira: 100 }); await online(spamAsk);
for (let i = 0; i < PLAYER_CALL.asksPerPairPerDay; i++) await db.phoneCall.create({ data: { kind: "PLAYER", callerId: spamAsk.id, callerName: "Asker", calleeId: ben.id, calleeName: "Ben", requestId: rq(), status: "ENDED", endedAt: new Date(Date.now() - 3_600_000), createdAt: new Date(Date.now() - 3_600_000), ringUntil: now(), gameWeek: 1, askKobo: naira(500), askStatus: "APPROVED", paidKobo: naira(500), askAt: new Date(Date.now() - 3_600_000) } });
await online(ben); const dd = await dial(db, spamAsk.uid, { to: "Ben", requestId: rq() }); await answer(db, ben.uid, { callId: dd.call.id });
await denied("a fourth request to the same player in a day", () => ask(db, spamAsk.uid, { callId: dd.call.id, amountNaira: 500 }), /already asked this player/i, 429);
ok("asking the same player for money is limited per day");

// calling someone not allowed to take calls, and finding people
await db.character.update({ where: { id: cy.id }, data: { suspendedUntil: new Date(Date.now() + 3_600_000) } });
await db.phoneCall.updateMany({ where: { kind: "PLAYER" }, data: { status: "ENDED", endedAt: new Date(Date.now() - 86_400_000), createdAt: new Date(Date.now() - 86_400_000) } });
const susp = await dial(db, ada.uid, { to: "Cy", requestId: rq() }); assert.equal(susp.reason, "unavailable"); ok("a suspended player cannot be rung");
await online(ben); const found = await findPeople(db, ada.uid, "Be"); assert.ok(found.players.find((p) => p.name === "Ben" && p.online === true));
await db.phoneLine.update({ where: { characterId: ben.id }, data: { seenAt: new Date(Date.now() - 60_000) } });
assert.equal((await findPeople(db, ada.uid, "Be")).players.find((p) => p.name === "Ben").online, false); ok("player search says who is online right now");
await books();
await done();
