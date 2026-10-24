import { makeDb } from "./db.mjs";
import { moneyOp, bulkPreview, bulkGrant } from "../../../lib/adminEconomy.js";
import { parseKobo, formatKobo, INT64_MAX } from "../../../lib/adminCore.js";
const db = makeDb(); let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log("  FAIL:", m)); };
const err = async (fn, re, m) => { try { await fn(); ok(false, m + " (no error)"); } catch (e) { ok(re.test(e.message), m + " -> " + e.message); } };
const bal = async (id) => (await db.account.findUnique({ where: { characterId: id } })).balance;
const ledgerSum = async (id) => { const a = await db.account.findUnique({ where: { characterId: id } }); const [r] = await db.$queryRaw`SELECT COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "creditAccountId"=${a.id}),0) - COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "debitAccountId"=${a.id}),0) AS s`; return BigInt(r.s); };
const A = "u0001", P = "c0005";

// parsing: exact, no rounding, no cap short of bigint
ok(parseKobo("5,000,000") === 500000000n, "commas");
ok(parseKobo("₦ 2500.50") === 250050n, "naira sign + kobo");
ok(parseKobo("1000000000000000") === 100000000000000000n, "quadrillion naira");
await err(async () => parseKobo("1.234"), /two decimal/, "3 decimals refused, not rounded");
await err(async () => parseKobo("92233720368547759"), /larger than the database/, "beyond bigint refused");
await err(async () => parseKobo(1e21), /too large|exponent/, "unsafe JS number refused");
ok(parseKobo(92233720368547758n.toString().slice(0, 17)) > 0n, "17-digit ok");
ok(formatKobo(123456789012345678901n) === "₦1,234,567,890,123,456,789.01", "format exact");

const b0 = await bal(P);
let r = await moneyOp(db, A, { characterId: P, mode: "credit", amount: "5000000000000", reason: "Testing a trillion-naira grant", requestId: "req-credit-0001" });
ok(r.ok && !r.duplicate, "credit ok");
ok((await bal(P)) === b0 + 500000000000000n, "balance +5 trillion exact");
ok(r.previousBalanceKobo === b0.toString() && r.newBalanceKobo === (b0 + 500000000000000n).toString(), "previous/new balance reported");
// duplicate request id: nothing changes
r = await moneyOp(db, A, { characterId: P, mode: "credit", amount: "5000000000000", reason: "Testing a trillion-naira grant", requestId: "req-credit-0001" });
ok(r.duplicate === true, "duplicate flagged");
ok((await bal(P)) === b0 + 500000000000000n, "duplicate changed nothing");
// race: 8 identical requests at once
const race = await Promise.allSettled(Array.from({ length: 8 }, () => moneyOp(db, A, { characterId: P, mode: "credit", amount: "1000", reason: "Concurrent duplicate test", requestId: "req-race-00001" })));
const applied = race.filter((x) => x.status === "fulfilled" && !x.value.duplicate).length;
console.log("  race:", race.map((x) => x.status === "fulfilled" ? (x.value.duplicate ? "dup" : "APPLIED") : "ERR:" + x.reason.message.slice(0, 60)).join(" "));
ok(applied === 1, `exactly one of 8 racing identical requests applied (got ${applied})`);
ok((await bal(P)) === b0 + 500000000000000n + 100000n, "balance after race = +₦1,000 once");
ok((await bal(P)) === (await ledgerSum(P)), "cached balance == ledger sum");
// debit, insufficient, set
r = await moneyOp(db, A, { characterId: P, mode: "debit", amount: "1000", reason: "Reversing the racing test", requestId: "req-debit-0001" });
ok(r.newBalanceKobo === (b0 + 500000000000000n).toString(), "debit exact");
await err(() => moneyOp(db, A, { characterId: P, mode: "debit", amount: "9000000000000", reason: "Too much to take", requestId: "req-debit-0002" }), /only has/, "debit more than balance refused");
r = await moneyOp(db, A, { characterId: P, mode: "set", amount: "123456789012345.67", reason: "Setting an exact balance", requestId: "req-set-00001" });
ok((await bal(P)) === 12345678901234567n, "set exact to ₦123,456,789,012,345.67");
r = await moneyOp(db, A, { characterId: P, mode: "set", amount: "123456789012345.67", reason: "Same balance again", requestId: "req-set-00002" });
ok(r.unchanged === true, "set to same balance is a no-op");
r = await moneyOp(db, A, { characterId: P, mode: "set", amount: "0", reason: "Zeroing the balance now", requestId: "req-set-00003" });
ok((await bal(P)) === 0n, "set to 0 allowed");
// overflow protection: near the int64 ceiling
await moneyOp(db, A, { characterId: P, mode: "set", amount: "92233720368547758.07", reason: "Largest possible balance", requestId: "req-set-00004" });
ok((await bal(P)) === INT64_MAX, "balance can reach int64 max exactly");
await err(() => moneyOp(db, A, { characterId: P, mode: "credit", amount: "0.01", reason: "One kobo past the limit", requestId: "req-over-00001" }), /largest amount the database can hold/, "one kobo past int64 refused, nothing written");
ok((await bal(P)) === INT64_MAX, "balance untouched after refusal");
// WORLD (system) derived balance stays exact too
const [w] = await db.$queryRaw`SELECT (COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "creditAccountId"='sys_world'),0) - COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "debitAccountId"='sys_world'),0))::text AS s`;
console.log("  WORLD derived balance:", w.s);
// validation
await err(() => moneyOp(db, A, { characterId: P, mode: "credit", amount: "10", reason: "short", requestId: "req-short-0001" }), /reason/i, "reason required");
await err(() => moneyOp(db, A, { characterId: P, mode: "credit", amount: "10", reason: "valid reason here", requestId: "x" }), /requestId/, "requestId required");
await err(() => moneyOp(db, A, { characterId: "nope-nope", mode: "credit", amount: "10", reason: "valid reason here", requestId: "req-nope-0001" }), /No such player/, "unknown player");
await err(() => moneyOp(db, A, { characterId: "c0008", mode: "credit", amount: "10", reason: "valid reason here", requestId: "req-del-00001" }), /closed/, "archived account refused");
await err(() => moneyOp(db, A, { characterId: P, mode: "mint", amount: "10", reason: "valid reason here", requestId: "req-mint-0001" }), /credit, debit or set/, "bad mode");
await err(() => moneyOp(db, A, { characterId: P, mode: "credit", amount: "-5", reason: "valid reason here", requestId: "req-neg-00001" }), /number/, "negative refused");
// audit trail
const au = await db.auditLog.findMany({ where: { action: { startsWith: "MONEY" } }, orderBy: { id: "asc" } });
const okRows = au.filter((a) => a.status === "OK"), failRows = au.filter((a) => a.status === "FAILED");
console.log("  audit: OK", okRows.length, "FAILED", failRows.length);
ok(okRows.filter((a) => a.id > 2).every((a) => a.requestId && a.detail?.reason), "OK rows carry request id + reason");
ok(okRows.find((a) => a.detail?.previousBalanceKobo && a.detail?.newBalanceKobo && a.detail?.recipient), "previous/new balance + recipient recorded");
ok(failRows.length >= 4 && failRows.every((a) => a.error), "failed attempts are kept with the error");
ok(new Set(okRows.map((a) => a.requestId)).size === okRows.length, "one OK audit row per request id");
const notes = await db.notification.count({ where: { characterId: P, kind: "ADMIN" } }); ok(notes >= 4, "player was notified (" + notes + ")");

// bulk
const pv = await bulkPreview(db, { audience: { type: "names", names: "Player2, Player3, nobody-here" }, amount: "1000000000" });
ok(pv.count === 2 && pv.missing.includes("nobody-here") && pv.totalKobo === "200000000000", "bulk preview exact: " + JSON.stringify({ c: pv.count, t: pv.totalKobo }));
await err(() => bulkGrant(db, A, { audience: { type: "names", names: "Player2, Player3" }, amount: "1000", reason: "Group reward test", requestId: "req-bulk-00001", confirm: "yes", expectedCount: 2 }), /GRANT 2/, "typed confirmation required");
await err(() => bulkGrant(db, A, { audience: { type: "names", names: "Player2, Player3" }, amount: "1000", reason: "Group reward test", requestId: "req-bulk-00001", confirm: "GRANT 2", expectedCount: 5 }), /audience changed/, "stale preview refused");
const b2 = await bal("c0002");
let g = await bulkGrant(db, A, { audience: { type: "names", names: "Player2, Player3" }, amount: "1000", reason: "Group reward test", requestId: "req-bulk-00002", confirm: "GRANT 2", expectedCount: 2 });
ok(g.done && g.granted === 2 && g.failed.length === 0, "bulk granted to 2");
g = await bulkGrant(db, A, { audience: { type: "names", names: "Player2, Player3" }, amount: "1000", reason: "Group reward test", requestId: "req-bulk-00002", confirm: "GRANT 2", expectedCount: 2 });
ok(g.repeated === 2 && g.granted === 0, "repeating the bulk grant pays nobody twice");
ok((await bal("c0002")) === b2 + 100000n, "Player2 got ₦1,000 exactly once");
// Forbes must survive a balance at the database limit PLUS business capital (an unchecked ::bigint cast used to overflow here)
const { getBoard, clearBoardCache } = await import("../../../lib/leaderboards.js");
await db.business.create({ data: { characterId: "c0005", type: "POS", name: "Overflow Test", capital: 123456789n, status: "ACTIVE", startedWeek: 1, lastWeek: 1 } });
clearBoardCache();
const fb = await getBoard(db, "forbes");
ok(fb.rows[0].name === "Player5" && fb.rows[0].value === (INT64_MAX + 123456789n).toString(), "Forbes ranks balance+business above int64 exactly: " + fb.rows[0]?.value);
ok(!fb.rows.some((r) => r.name === "Player9") && !fb.rows.some((r) => r.name === "Player8"), "hidden (Player9) and archived (Player8) players are not on the board");
ok(fb.rows.every((r, i, a) => i === 0 || BigInt(a[i - 1].value) >= BigInt(r.value)), "board is sorted numerically");
console.log(`\n${pass} passed, ${fail} failed`); await db.end(); process.exit(fail ? 1 : 0);
