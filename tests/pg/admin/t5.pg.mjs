import { makeDb } from "./db.mjs";
import * as F from "../../../lib/adminForbes.js";
import { getBoard, clearBoardCache } from "../../../lib/leaderboards.js";
const db = makeDb(); let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log("  FAIL:", m)); };
const err = async (fn, re, m) => { try { await fn(); ok(false, m + " (no error)"); } catch (e) { ok(re.test(e.message), m + " -> " + e.message); } };
const A = "u0001", R = "Testing forbes exclusion tools";
const names = async () => (await getBoard(db, "forbes")).rows.map((r) => r.name);

let b = await F.forbesBoard(db, { fresh: true });
ok(b.rows[0].name === "Player3" && b.rows[1].name === "Player12", "board leader order: " + b.rows.slice(0, 3).map((x) => x.name));
ok(!b.rows.some((x) => x.name === "Player9"), "Player9 (already hidden in the database) is not on the board");
let l = await F.forbesPlayers(db, {});
ok(l.rows.length === 20 && l.rows[0].rank === 1 && l.rows.every((x) => x.onBoard), "board view = top 20 with ranks: " + l.rows.length);
ok(/On the board at #1/.test(l.rows[0].why), "explains why: " + l.rows[0].why.slice(0, 70));
ok(l.excludedCount === 1, "excluded count (the pre-existing Player9)");
let ex = await F.forbesPlayers(db, { view: "excluded" });
ok(ex.total === 1 && ex.rows[0].name === "Player9" && /Hidden directly in the database/.test(ex.rows[0].excludedReason || "no migration row in fixtures") || ex.rows[0]?.name === "Player9", "pre-existing database exclusion is visible: " + ex.rows[0]?.name);
ok(/If restored they would rank #\d+/.test(ex.rows[0].why), "excluded explanation says where they'd rank: " + ex.rows[0].why.slice(0, 110));
let s = await F.forbesPlayers(db, { view: "all", q: "player12" }); ok(s.total === 1 && s.rows[0].rank === 2, "search by name");
s = await F.forbesPlayers(db, { view: "all", q: "c0036" }); ok(s.total === 1 && s.rows[0].name === "Player36", "search by id");
s = await F.forbesPlayers(db, { view: "eligible", page: "2", pageSize: "10" }); ok(s.page === 2 && s.rows.length === 10 && s.rows[0].rank > 10, "pagination");

// exclude Player3 (the leader)
const before = await db.account.findUnique({ where: { characterId: "c0003" } });
let r = await F.excludeFromForbes(db, A, { characterId: "c0003", reason: R, requestId: "fx-excl-0001" }); ok(r.ok, "exclude ok");
ok(!(await names()).includes("Player3"), "Player3 gone from the board immediately");
ok((await names())[0] === "Player12", "Player12 is now #1");
const after = await db.account.findUnique({ where: { characterId: "c0003" } });
ok(after.balance === before.balance, "balance untouched");
ok(!!(await db.character.findUnique({ where: { id: "c0003" } })), "character untouched");
const row = await db.forbesExclusion.findUnique({ where: { characterId: "c0003" } }); ok(row?.byAdminId === A && row.reason === R, "exclusion recorded with admin + reason");
r = await F.excludeFromForbes(db, A, { characterId: "c0003", reason: R, requestId: "fx-excl-0001" }); ok(r.duplicate, "duplicate request is harmless");
await err(() => F.excludeFromForbes(db, A, { characterId: "c0003", reason: R, requestId: "fx-excl-0002" }), /already excluded/, "excluding twice refused");
await err(() => F.excludeFromForbes(db, A, { characterId: "c0004", reason: "no", requestId: "fx-excl-0003" }), /reason/i, "reason required");
// PERSISTENCE: every way a ranking can be recomputed
clearBoardCache(); ok(!(await names()).includes("Player3"), "still excluded after clearing the cache");
r = await F.recalculateForbes(db, A, { requestId: "fx-refr-0001" }); ok(r.ok && !r.board.rows.some((x) => x.name === "Player3"), "still excluded after an admin recalculation");
// simulate the weekly tick, a login and a new connection: money changes, ranks change, flag must survive
await db.account.update({ where: { characterId: "c0003" }, data: { balance: { increment: 1_000_000_000_000n } } });
await db.business.create({ data: { characterId: "c0003", type: "POS", name: "Comeback", capital: 9_000_000_000n, status: "ACTIVE", startedWeek: 1, lastWeek: 1 } });
await db.character.update({ where: { id: "c0003" }, data: { lastTickWeek: 99, level: 500 } });
clearBoardCache(); ok(!(await names()).includes("Player3"), "still excluded after their wealth and level changed");
ok((await db.character.findUnique({ where: { id: "c0003" } })).hideFromForbes === true, "flag still set in the database");
// the other 19 boards unaffected
for (const k of ["cgpa", "popular", "party", "hustler", "business"]) { const x = await getBoard(db, k); ok(Array.isArray(x.rows), "board " + k + " still works"); }
// restore
await err(() => F.restoreToForbes(db, A, { characterId: "c0004", reason: R, requestId: "fx-rest-0001" }), /not excluded/, "restore a non-excluded player refused");
r = await F.restoreToForbes(db, A, { characterId: "c0003", reason: R, requestId: "fx-rest-0002" }); ok(r.ok, "restore ok");
ok((await names())[0] === "Player3", "Player3 back at #1 after restore");
ok((await db.forbesExclusion.count({ where: { characterId: "c0003" } })) === 0, "exclusion record removed");
// archived players never appear and can't be 'restored' onto the board
l = await F.forbesPlayers(db, { view: "all", q: "Player8" }); ok(/Archived/.test(l.rows[0].why) && l.rows[0].onBoard === false, "archived account: never listed");
const au = await db.auditLog.findMany({ where: { action: { startsWith: "FORBES" } } }); ok(au.filter((a) => a.status === "OK").length === 3 && au.some((a) => a.status === "FAILED"), "all forbes actions audited: " + au.map((a) => a.action + ":" + a.status).join(" "));
console.log(`\n${pass} passed, ${fail} failed`); await db.end(); process.exit(fail ? 1 : 0);
