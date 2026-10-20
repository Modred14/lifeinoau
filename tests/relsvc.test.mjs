// tests/relsvc.test.mjs
import assert from "node:assert/strict";
import { getRelationship, relate, decidePregnancy } from "../lib/relationshipService.js";
import { makeDb } from "./fakedb.mjs";
import { NOTES } from "../lib/relationships.js";

let serial = 0;
const requestId = () => "relationship-request-" + ++serial;
function fixture({ paired = true, kind = "TALKING" } = {}) {
  const db = makeDb(["character", "account", "bond", "loveRequest", "bondEvent", "chat", "message", "block", "notification", "actionLog", "ledgerEntry", "pregnancy", "gameClock"], {
    unique: { actionLog: ["characterId", "requestId"], bond: ["lowId", "highId"], ledgerEntry: ["idempotencyKey"] },
    defaults: {
      bond: { kind: "TALKING", prevKind: null, affection: 0, dates: 0, meals: 0, visits: 0, done: {}, together: false, homeHostel: null, cheatedBy: null, strikes: 0, endedWeek: null, endedBy: null },
      loveRequest: { status: "PENDING", variant: null },
      pregnancy: { status: "PENDING" },
    },
    join: { character: (c, T) => c && ({ ...c, account: T.account.find((a) => a.characterId === c.id), faculty: { name: "Law", difficulty: 1 } }) },
  });
  const T = db.T();
  T.gameClock.push({ id: 1, startedAt: new Date(0), campusEpoch: new Date(), campusStartWeek: 8 });
  for (const [id, name, gender, hostel] of [["a", "Tunde", "M", "Awo"], ["z", "Zainab", "F", "Moremi"], ["x", "Seyi", "M", "Fajuyi"]]) {
    T.character.push({ id, userId: "u_" + id, name, gender, hostel, expelled: false, graduated: false, suspendedUntilWeek: 0, energyRefilledAt: new Date(), jailedUntil: null, lastTickWeek: 8, joinedWeek: 1, sessionStartWeek: 1, level: 100, energy: 90, happiness: 50, popularity: 20, luck: 50, dependents: 0 });
    T.account.push({ id: "account_" + id, kind: "PLAYER", characterId: id, balance: 100_000_000n });
  }
  for (const name of ["VENUES", "CLINICS"]) T.account.push({ id: name, kind: "SYSTEM", systemName: name, balance: 0n });
  if (paired) T.bond.push({ id: 100n, lowId: "a", highId: "z", kind, prevKind: null, affection: 20, dates: 0, meals: 0, visits: 0, done: {}, startedWeek: 8, kindWeek: 8, lastWeek: 8, together: false, homeHostel: null, cheatedBy: null, strikes: 0, endedWeek: null, endedBy: null });
  const act = (who, body) => relate(db, "u_" + who, { requestId: requestId(), id: "100", ...body });
  const balance = (who) => T.account.find((a) => a.characterId === who).balance;
  const advance = (week) => { T.gameClock[0].campusStartWeek = week; T.character.forEach((c) => { c.lastTickWeek = week; }); };
  return { db, T, act, balance, advance };
}
async function unchangedAfterFailure(T, operation, status) {
  const before = structuredClone(T);
  await assert.rejects(operation(), { status });
  assert.deepEqual(T, before);
}

{
  const { db, T, act } = fixture({ paired: false });
  await assert.rejects(getRelationship(db, "unknown"), { status: 404 });
  await unchangedAfterFailure(T, () => relate(db, "u_a", { action: "add", name: "Zainab" }), 400);
  await unchangedAfterFailure(T, () => act("a", { action: "add", name: "Zainab" }), 409);
  db.say("a", "z", "Hi");
  await unchangedAfterFailure(T, () => act("a", { action: "add", name: "Zainab" }), 409);
  db.say("z", "a", "Hello");
  assert.equal((await getRelationship(db, "u_a")).discover[0].name, "Zainab");
  T.block.push({ blockerId: "z", blockedId: "a" });
  assert.equal((await getRelationship(db, "u_a")).discover.length, 0);
  await unchangedAfterFailure(T, () => act("a", { action: "add", name: "Zainab" }), 403);
  T.block.length = 0;
  const added = await act("a", { action: "add", name: "zainab" });
  assert.equal(added.kind, "TALKING");
  await unchangedAfterFailure(T, () => act("a", { action: "add", name: "Zainab" }), 409);
  await unchangedAfterFailure(T, () => act("a", { action: "add", name: "Tunde" }), 404);
  await unchangedAfterFailure(T, () => act("x", { action: "note", id: added.id, line: 0 }), 404);
}

{
  const { db, T, act, balance } = fixture();
  const account = () => T.account.find((a) => a.characterId === "a");
  account().balance = 100n;
  const id = requestId();
  await unchangedAfterFailure(T, () => act("a", { action: "gift", tier: "medium", requestId: id }), 402);
  account().balance = 100_000_000n;
  await unchangedAfterFailure(T, () => act("a", { action: "gift", tier: "missing" }), 400);
  const beforeFault = structuredClone(T), notify = db.notification.create;
  db.notification.create = async () => { throw new Error("notification write failed"); };
  await assert.rejects(act("a", { action: "gift", tier: "medium", requestId: id }), /notification write failed/);
  assert.deepEqual(T, beforeFault);
  db.notification.create = notify;
  const before = balance("a");
  await act("a", { action: "gift", tier: "medium", requestId: id });
  assert.equal(balance("a"), before - 2_000_000n);
  assert.equal(T.ledgerEntry.length, 1);
  assert.equal(T.bond[0].affection, 32);
  const after = structuredClone(T);
  assert.equal((await act("a", { action: "gift", tier: "medium", requestId: id })).duplicate, true);
  assert.deepEqual(T, after);
  await unchangedAfterFailure(T, () => act("a", { action: "gift", tier: "small" }), 409);
  await act("z", { action: "gift", tier: "small" });
  assert.equal(T.ledgerEntry.length, 2);
  await unchangedAfterFailure(T, () => act("a", { action: "note", line: 99 }), 400);
  await act("a", { action: "note", line: 0 });
  assert.equal(T.message.at(-1).body, NOTES[0]);
  assert.equal(T.message.at(-1).fromA, true, "from Tunde (a) to Zainab (z): a sits first in the pair");
}

{
  const { db, T, act, balance } = fixture();
  const initial = balance("a");
  const invite = await act("a", { action: "request", kind: "DATE" });
  assert.equal(balance("a"), initial);
  await unchangedAfterFailure(T, () => act("a", { action: "answer", id: invite.id, accept: true }), 403);
  await unchangedAfterFailure(T, () => act("x", { action: "answer", id: invite.id, accept: true }), 404);
  T.account.find((a) => a.characterId === "a").balance = 100n;
  const id = requestId();
  await unchangedAfterFailure(T, () => act("z", { action: "answer", id: invite.id, accept: true, requestId: id }), 402);
  T.account.find((a) => a.characterId === "a").balance = initial;
  T.character.find((c) => c.id === "a").energy = 1;
  await unchangedAfterFailure(T, () => act("z", { action: "answer", id: invite.id, accept: true, requestId: id }), 409);
  T.character.find((c) => c.id === "a").energy = 90;
  await act("z", { action: "answer", id: invite.id, accept: true, requestId: id });
  assert.equal(balance("a"), initial - 1_500_000n);
  assert.equal(balance("z"), initial);
  assert.equal(T.loveRequest[0].status, "ACCEPTED");
  assert.equal(T.bond[0].dates, 1);
  assert(T.character.filter((c) => c.id !== "x").every((c) => c.energy === 75));
  const beforeReplay = structuredClone(T);
  assert.equal((await act("z", { action: "answer", id: invite.id, accept: true, requestId: id })).duplicate, true);
  assert.deepEqual(T, beforeReplay);
  await unchangedAfterFailure(T, () => act("z", { action: "request", kind: "DATE" }), 409);
  assert.equal((await getRelationship(db, "u_a")).bonds[0].dates, 1);
}

{
  const { db, T, act, balance, advance } = fixture();
  const initial = balance("a");
  const declined = await act("a", { action: "request", kind: "DATE" });
  await act("z", { action: "answer", id: declined.id, accept: false });
  assert.equal(T.loveRequest[0].status, "DECLINED");
  assert.equal(balance("a"), initial);
  assert.equal(T.bond[0].dates, 0);
  const cancelled = await act("a", { action: "request", kind: "DATE" });
  await unchangedAfterFailure(T, () => act("z", { action: "cancel", id: cancelled.id }), 403);
  await act("a", { action: "cancel", id: cancelled.id });
  assert.equal(T.loveRequest[1].status, "CANCELLED");
  const expired = await act("a", { action: "request", kind: "DATE" });
  advance(11);
  assert((await getRelationship(db, "u_z")).requests.some((r) => r.id === expired.id));
  advance(12);
  await unchangedAfterFailure(T, () => act("z", { action: "answer", id: expired.id, accept: true }), 410);
  assert.equal((await getRelationship(db, "u_z")).requests.length, 0);
  assert.equal(T.loveRequest[2].status, "EXPIRED");
  assert.equal(balance("a"), initial);
  assert.equal(T.ledgerEntry.length, 0);
}

for (const choice of ["keep", "end"]) {
  const { db, T, balance } = fixture({ kind: "BABE" });
  T.pregnancy.push({ id: 1n, characterId: "z", relationshipId: 100n, startedWeek: 7, decideBy: 10, status: "PENDING" });
  assert.equal((await getRelationship(db, "u_z")).pregnancy.weeksLeft, 3);
  await unchangedAfterFailure(T, () => decidePregnancy(db, "u_x", { choice, requestId: requestId() }), 404);
  await unchangedAfterFailure(T, () => decidePregnancy(db, "u_z", { choice: "invalid", requestId: requestId() }), 400);
  T.account.find((a) => a.characterId === "z").balance = 100n;
  const id = requestId();
  await unchangedAfterFailure(T, () => decidePregnancy(db, "u_z", { choice, requestId: id }), 402);
  T.account.find((a) => a.characterId === "z").balance = 100_000_000n;
  const initial = balance("z");
  assert.equal((await decidePregnancy(db, "u_z", { choice, requestId: id })).choice, choice);
  assert.equal(balance("z"), initial - (choice === "keep" ? 15_000_000n : 50_000_000n));
  assert.equal(T.pregnancy[0].status, choice === "keep" ? "KEPT" : "ENDED");
  assert.equal(T.character.find((c) => c.id === "z").dependents, choice === "keep" ? 1 : 0);
  const beforeReplay = structuredClone(T);
  assert.equal((await decidePregnancy(db, "u_z", { choice, requestId: id })).duplicate, true);
  assert.deepEqual(T, beforeReplay);
  await unchangedAfterFailure(T, () => decidePregnancy(db, "u_z", { choice, requestId: requestId() }), 404);
}
console.log("Relationship service access, consent, payments, failure rollback, expiry and replay checks passed");
