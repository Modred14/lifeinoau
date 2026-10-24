import { makeDb } from "./db.mjs";
import * as M from "../../../lib/adminModeration.js";
import { gateOf, clearAccountCache } from "../../../lib/accountGate.js";
const db = makeDb(); let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log("  FAIL:", m)); };
const err = async (fn, re, m) => { try { await fn(); ok(false, m + " (no error)"); } catch (e) { ok(re.test(e.message), m + " -> " + e.message); } };
const A = "u0001", rid = (() => { let n = 0; return (p) => `${p}-${String(++n).padStart(6, "0")}`; })();
const user = (id) => db.user.findUnique({ where: { id } });
const gate = async (id) => gateOf(await user(id));
const R = "Testing the moderation tools";

// --- account suspend / restore
let r = await M.suspendAccount(db, A, { ref: "Player5", reason: R, hours: 2, requestId: rid("sus") });
ok(r.ok, "suspend ok"); let g = await gate("u0005");
ok(!g.ok && g.code === "SUSPENDED" && /suspended until/.test(g.message), "gate blocks suspended: " + g.message);
r = await M.suspendAccount(db, A, { ref: "Player5", reason: R, hours: 2, requestId: "sus-000001" }); ok(r.duplicate, "same request id is a duplicate");
await err(() => M.suspendAccount(db, A, { ref: "Player1", reason: R, hours: 2, requestId: rid("sus") }), /own account/, "cannot suspend yourself (Player1 is the admin)");
await db.user.update({ where: { id: "u0002" }, data: { role: "ADMIN" } });
await err(() => M.suspendAccount(db, A, { ref: "Player2", reason: R, hours: 2, requestId: rid("sus") }), /Administrators cannot/, "cannot suspend another admin");
await db.user.update({ where: { id: "u0002" }, data: { role: "PLAYER" } });
await err(() => M.suspendAccount(db, A, { ref: "Player6", reason: "short", hours: 2, requestId: rid("sus") }), /reason/i, "reason required");
await err(() => M.suspendAccount(db, A, { ref: "Player6", reason: R, requestId: rid("sus") }), /Choose how long/, "duration required");
await err(() => M.suspendAccount(db, A, { ref: "Player6", reason: R, until: "2020-01-01", requestId: rid("sus") }), /future/, "past end date refused");
r = await M.suspendAccount(db, A, { ref: "c0006", reason: R, indefinite: true, requestId: rid("sus") });
g = await gate("u0006"); ok(!g.ok && /until an administrator restores/.test(g.message), "indefinite suspension");
// a timed suspension ends by itself
await db.user.update({ where: { id: "u0005" }, data: { statusUntil: new Date(Date.now() - 1000) } });
ok((await gate("u0005")).ok, "timed suspension lifts itself when its deadline passes");
r = await M.restoreAccount(db, A, { ref: "Player6", reason: R, requestId: rid("res") }); ok((await gate("u0006")).ok, "restore");
await err(() => M.restoreAccount(db, A, { ref: "Player6", reason: R, requestId: rid("res") }), /already active/, "restore an active account refused");

// --- delete (archive) with a running stake match
await db.gameMatch.create({ data: { game: "CHESS", mode: "FRIEND", status: "ACTIVE", hostId: "c0010", guestId: "c0011", stakeKobo: 500000n, state: {}, startedAt: new Date() } });
const house = await db.account.upsert({ where: { systemName: "GAMES" }, update: {}, create: { kind: "SYSTEM", systemName: "GAMES" } });
const acc = (c) => db.account.findUnique({ where: { characterId: c } });
const [a10, a11] = [await acc("c0010"), await acc("c0011")];
await db.account.update({ where: { id: a10.id }, data: { balance: { decrement: 500000n } } }); await db.account.update({ where: { id: a11.id }, data: { balance: { decrement: 500000n } } });
await db.ledgerEntry.createMany({ data: [{ idempotencyKey: "t:esc:10", debitAccountId: a10.id, creditAccountId: house.id, amount: 500000n, memo: "escrow", gameWeek: 1 }, { idempotencyKey: "t:esc:11", debitAccountId: a11.id, creditAccountId: house.id, amount: 500000n, memo: "escrow", gameWeek: 1 }] });
const m = await db.gameMatch.findFirst({ where: { hostId: "c0010" } }); await db.gameSeat.createMany({ data: [{ characterId: "c0010", matchId: m.id, seat: 0 }, { characterId: "c0011", matchId: m.id, seat: 1 }] });
const b11 = (await acc("c0011")).balance;
await err(() => M.deleteAccount(db, A, { ref: "Player10", reason: R, confirmName: "wrong", requestId: rid("del") }), /Type Player10 exactly/, "delete needs the typed name");
ok((await user("u0010")).status === "ACTIVE", "nothing changed after a failed confirmation");
r = await M.deleteAccount(db, A, { ref: "Player10", reason: R, confirmName: "player10", requestId: rid("del") });
ok(r.ok && r.matchesVoided === 1, "delete ok, match voided: " + JSON.stringify(r));
g = await gate("u0010"); ok(!g.ok && g.code === "DELETED", "archived account is blocked");
ok((await db.character.findUnique({ where: { id: "c0010" } })) != null, "character kept");
ok((await acc("c0011")).balance === b11 + 500000n, "opponent's wager was returned");
ok((await acc("c0010")).balance === 10n * 7919n * 100n, "deleted player's wager was returned too (balance intact)");
ok((await db.gameMatch.findUnique({ where: { id: m.id } })).status === "VOID", "match is VOID");
ok((await db.gameSeat.count({ where: { matchId: m.id } })) === 0, "seats cleared");
await err(() => M.deleteAccount(db, A, { ref: "Player10", reason: R, confirmName: "Player10", requestId: rid("del") }), /already archived/, "double delete refused");
r = await M.restoreAccount(db, A, { ref: "Player10", reason: R, requestId: rid("res") }); ok((await gate("u0010")).ok, "archived account restored");
// no-character account
r = await M.suspendAccount(db, A, { ref: "u0040", reason: R, hours: 5, requestId: rid("sus") }); ok(r.ok, "account with no character can be suspended");
r = await M.deleteAccount(db, A, { ref: "u0039", reason: R, confirmName: "player39@example.com", requestId: rid("del") }); ok(r.ok, "no-character delete confirms with the email");

// --- discipline
r = await M.warnPlayer(db, A, { ref: "Player12", message: "Please stop spamming chat", requestId: rid("wrn") }); ok(r.warningNumber === 1, "warn #1");
r = await M.warnPlayer(db, A, { ref: "Player12", message: "Second warning for spamming", requestId: rid("wrn") }); ok(r.warningNumber === 2, "warn #2");
ok(await db.notification.count({ where: { characterId: "c0012", kind: "ADMIN", body: { startsWith: "Warning" } } }) === 2, "player received both warnings");
await M.gameSuspend(db, A, { ref: "Player13", hours: 3, reason: R, requestId: rid("gs") });
let c = await db.character.findUnique({ where: { id: "c0013" } }); ok(c.suspendedUntil && +c.suspendedUntil > Date.now() + 2.9 * 3600e3, "academic suspension set 3h");
await M.gameSuspendClear(db, A, { ref: "Player13", reason: R, requestId: rid("gu") }); c = await db.character.findUnique({ where: { id: "c0013" } }); ok(!c.suspendedUntil, "academic suspension cleared");
await M.expelPlayer(db, A, { ref: "Player14", reason: R, requestId: rid("ex") }); c = await db.character.findUnique({ where: { id: "c0014" } }); ok(c.expelled && c.expelledUntil, "expelled with deadline");
await err(() => M.expelPlayer(db, A, { ref: "Player14", reason: R, requestId: rid("ex") }), /already expelled/, "double expel refused");
await M.reinstatePlayer(db, A, { ref: "Player14", reason: R, requestId: rid("rn") }); c = await db.character.findUnique({ where: { id: "c0014" } }); ok(!c.expelled && !c.expelledUntil && c.level === 100 * (1 + 14 % 4), "reinstated, level untouched");
await db.floorZero.create({ data: { characterId: "c0011", reason: "test", releaseAt: new Date(Date.now() + 3600e3), bill: 100n } });
await err(() => M.releaseFromCustody(db, A, { ref: "Player12", reason: R, requestId: rid("rl") }), /not in custody/, "release when free refused");
await db.character.update({ where: { id: "c0011" }, data: { jailedUntil: new Date(Date.now() + 3600e3), placeId: "floor0" } });
await M.releaseFromCustody(db, A, { ref: "Player11", reason: R, requestId: rid("rl") });
c = await db.character.findUnique({ where: { id: "c0011" } }); ok(!c.jailedUntil, "released"); ok((await db.floorZero.findFirst({ where: { characterId: "c0011" } })).status === "SERVED", "custody record closed");

// --- repair
await db.character.update({ where: { id: "c0015" }, data: { health: 5, energy: 0, strikes: 4 } });
await M.resetAttributes(db, A, { ref: "Player15", fields: ["health", "strikes", "bogus"], reason: R, requestId: rid("rs") });
c = await db.character.findUnique({ where: { id: "c0015" } }); ok(c.health === 80 && c.strikes === 0 && c.energy === 0, "reset only the chosen attributes");
await err(() => M.resetAttributes(db, A, { ref: "Player15", fields: ["luck"], reason: R, requestId: rid("rs") }), /at least one/, "unsupported attribute refused");
await M.editCharacter(db, A, { ref: "Player15", set: { level: 300, happiness: 77, hostel: "Awo" }, reason: R, requestId: rid("ed") });
c = await db.character.findUnique({ where: { id: "c0015" } }); ok(c.level === 300 && c.happiness === 77 && c.hostel === "Awo", "edit applied");
await err(() => M.editCharacter(db, A, { ref: "Player15", set: { level: 250 }, reason: R, requestId: rid("ed") }), /not a valid/, "level 250 refused");
await err(() => M.editCharacter(db, A, { ref: "Player15", set: { health: 101 }, reason: R, requestId: rid("ed") }), /not a valid/, "stat out of range refused");
await err(() => M.editCharacter(db, A, { ref: "Player15", set: { hostel: "Moremi" }, reason: R, requestId: rid("ed") }), /not a home/, "wrong-gender hostel refused");
await err(() => M.editCharacter(db, A, { ref: "Player15", set: { jobKey: "ceo_of_everything" }, reason: R, requestId: rid("ed") }), /not a job/, "unknown job refused");
await db.character.update({ where: { id: "c0016" }, data: { tripAt: new Date(), tripX: 1, tripZ: 2, tripH: 0, tripMode: "keke", sleepingSince: new Date() } });
await M.fixState(db, A, { ref: "Player16", fix: "travel", reason: R, requestId: rid("fx") }); await M.fixState(db, A, { ref: "Player16", fix: "sleep", reason: R, requestId: rid("fx") });
c = await db.character.findUnique({ where: { id: "c0016" } }); ok(!c.tripAt && c.tripMode === "" && !c.sleepingSince, "trip and sleep cleared");
await err(() => M.fixState(db, A, { ref: "Player16", fix: "activity", reason: R, requestId: rid("fx") }), /Nothing is running/, "nothing to cancel");
await db.jobShift.create({ data: { characterId: "c0016", jobKey: "vendor", shiftKey: "morning", gameDay: 1, gameWeek: 1, startedAt: new Date(), endsAt: new Date(Date.now() + 36e5), energyCost: 10, payKobo: 100n, status: "ACTIVE", requestId: "t-shift-1" } });
r = await M.fixState(db, A, { ref: "Player16", fix: "activity", reason: R, requestId: rid("fx") }); ok(r.shifts === 1, "stuck job shift cancelled");

// --- reading
let rs = await M.restrictions(db, {}); console.log("  restrictions:", rs.total, rs.rows.map((x) => x.name + ":" + x.restrictions.map((y) => y.kind).join("+")).join(" | "));
ok(rs.total >= 3 && rs.rows.every((x) => x.restrictions.length > 0), "restrictions listed, and every row really has one (an expired suspension must not appear; the DB time zone must not matter)");
ok(!rs.rows.some((x) => x.name === "Player5"), "Player5 (suspension expired) is not listed");
rs = await M.restrictions(db, { kind: "deleted" }); ok(rs.rows.every((x) => x.restrictions[0].kind === "Archived"), "filter: archived");
const mh = await M.moderationHistory(db, {}); ok(mh.total > 20 && mh.rows[0].action, "moderation history: " + mh.total);
const mp = await M.moderationHistory(db, { player: "c0012" }); ok(mp.total === 2 && mp.rows.every((x) => x.action === "WARN"), "history for one player");
console.log(`\n${pass} passed, ${fail} failed`); await db.end(); process.exit(fail ? 1 : 0);
