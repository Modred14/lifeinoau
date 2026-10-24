import { makeDb } from "./db.mjs";
import * as G from "../../../lib/adminGame.js";
const db = makeDb(); let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log("  FAIL:", m)); };
const err = async (fn, re, m) => { try { await fn(); ok(false, m + " (no error)"); } catch (e) { ok(re.test(e.message), m + " -> " + e.message); } };
const A = "u0001", R = "Testing game administration", rid = (() => { let n = 0; return (p) => `${p}-${String(++n).padStart(6, "0")}`; })();
// seed some rows the systems read
await db.character.update({ where: { id: "c0004" }, data: { jobKey: "vendor", jobXp: 12, hostel: "Awo", transport: "Keke" } });
await db.jobShift.create({ data: { characterId: "c0004", jobKey: "vendor", shiftKey: "morning", gameDay: 1, gameWeek: 1, startedAt: new Date(), endsAt: new Date(Date.now() + 36e5), energyCost: 10, payKobo: 800000n, status: "CLAIMED", requestId: "t-s-1" } });
await db.examResult.create({ data: { characterId: "c0004", gameWeek: 6, level: 100, score: 71, gradePoint: 4, caught: true } });
await db.hustleRun.create({ data: { characterId: "c0004", kind: "crew", placeId: "h_awo", startedAt: new Date(), endsAt: new Date(), energyCost: 5, status: "DONE", payKobo: 900000n, requestId: "t-h-1" } });
await db.bond.create({ data: { lowId: "c0002", highId: "c0003", kind: "BABE", affection: 60, startedWeek: 1, kindWeek: 1, lastWeek: 1 } });
await db.clubTransaction.create({ data: { characterId: "c0004", clubId: "club_0203", kind: "SPRAY", itemId: "spray", itemName: "Money spray", amount: 50000000n, requestId: "t-c-1", gameWeek: 1 } });
await db.billboardSlot.create({ data: { board: 1, slot: 1, ownerId: "c0004", orderId: "o1", status: "PAID", amountKobo: 100n, orderKobo: 100n, caption: "Hello" } });

const ov = await G.gameOverview(db); ok(ov.players === 36 && ov.employed >= 1 && ov.activeBusinesses === 2, "overview counts: " + JSON.stringify({ p: ov.players, e: ov.employed, b: ov.activeBusinesses }));
for (const v of Object.keys(G.VIEWS)) { try { const r = await G.gameList(db, v, {}); ok(r && (Array.isArray(r.rows) || r.byLevel || r.sold), "view " + v); } catch (e) { ok(false, "view " + v + " threw: " + e.message); } }
let r = await G.gameList(db, "jobs.definitions", {}); ok(r.rows.find((x) => x.key === "vendor")?.employed === 1, "job definitions show employment");
r = await G.gameList(db, "jobs.shifts", { status: "CLAIMED" }); ok(r.total === 1 && r.rows[0].pay === "800000", "shifts filter");
r = await G.gameList(db, "businesses", { sort: "capital", q: "Big" }); ok(r.total === 1 && r.rows[0].capital === "100000000", "businesses search");
r = await G.gameList(db, "academics.exams", { caught: "1" }); ok(r.total === 1, "exams caught filter");
r = await G.gameList(db, "events.clubs", { club: "club_0203" }); ok(r.total === 1 && r.totals[0].sum === "50000000", "club spend");
r = await G.gameList(db, "relationships.bonds", { q: "Player2" }); ok(r.total === 1 && r.rows[0].kind === "BABE", "bonds search");
r = await G.gameList(db, "hostels.occupancy", {}); ok(r.rows.find((x) => x.hostel === "Awo")?.players === 1, "hostel occupancy");
await err(() => G.gameList(db, "nope", {}), /Unknown view/, "unknown view");

// actions
r = await G.gameAction(db, A, "faculty.update", { facultyId: 1, difficulty: "1.35", reason: R, requestId: rid("fa") }); ok((await db.faculty.findUnique({ where: { id: 1 } })).difficulty.toString() === "1.35", "faculty difficulty updated");
await err(() => G.gameAction(db, A, "faculty.update", { facultyId: 1, difficulty: "9", reason: R, requestId: rid("fa") }), /between 0.50 and 2.00/, "difficulty bounds");
// business close returns capital through the ledger
const world = await db.account.findUnique({ where: { systemName: "WORLD" } });
let pool = await db.account.findUnique({ where: { systemName: "BUSINESS" } }); const before = (await db.account.findUnique({ where: { characterId: "c0012" } })).balance;
const biz = await db.business.findFirst({ where: { characterId: "c0012" } });
r = await G.gameAction(db, A, "business.close", { id: biz.id.toString(), reason: R, requestId: rid("bc") });
ok((await db.account.findUnique({ where: { characterId: "c0012" } })).balance === before + biz.capital, "capital returned to the owner");
ok((await db.business.findUnique({ where: { id: biz.id } })).status === "CLOSED", "business closed");
const le = await db.ledgerEntry.findFirst({ where: { memo: { startsWith: "Closed " } } }); ok(le && le.amount === biz.capital, "ledger entry written");
await err(() => G.gameAction(db, A, "business.close", { id: biz.id.toString(), reason: R, requestId: rid("bc") }), /not active/, "close twice refused");
// bond end
const bond = await db.bond.findFirst(); r = await G.gameAction(db, A, "bond.end", { bondId: bond.id.toString(), reason: R, requestId: rid("be") }); ok((await db.bond.findUnique({ where: { id: bond.id } })).kind === "EX", "bond ended");
// items & cars
r = await G.gameAction(db, A, "item.grant", { characterId: "c0004", key: Object.keys((await import("../../../lib/furniture.js")).ITEMS)[0], quantity: 2, reason: R, requestId: rid("ig") }); ok(await db.roomItem.count({ where: { characterId: "c0004" } }) === 2, "2 items granted");
await err(() => G.gameAction(db, A, "item.grant", { characterId: "c0004", key: "unicorn", reason: R, requestId: rid("ig") }), /not an item/, "unknown item refused");
const it = await db.roomItem.findFirst({ where: { characterId: "c0004" } }); await G.gameAction(db, A, "item.remove", { id: it.id.toString(), reason: R, requestId: rid("ir") }); ok(await db.roomItem.count({ where: { characterId: "c0004" } }) === 1, "item removed");
const carId = (await import("../../../lib/cars.js")).CARS[0].id;
await G.gameAction(db, A, "car.grant", { characterId: "c0004", modelId: carId, reason: R, requestId: rid("cg") });
await err(() => G.gameAction(db, A, "car.grant", { characterId: "c0004", modelId: carId, reason: R, requestId: rid("cg") }), /already owns/, "second copy refused");
await db.character.update({ where: { id: "c0004" }, data: { activeCar: carId, activeCarColor: "x" } });
const oc = await db.ownedCar.findFirst({ where: { characterId: "c0004" } }); await G.gameAction(db, A, "car.remove", { id: oc.id.toString(), reason: R, requestId: rid("cr") });
ok((await db.character.findUnique({ where: { id: "c0004" } })).activeCar === "", "removing the active car clears it");
// match void with real escrow
const house = await db.account.upsert({ where: { systemName: "GAMES" }, update: {}, create: { kind: "SYSTEM", systemName: "GAMES" } });
const [a5, a6] = [await db.account.findUnique({ where: { characterId: "c0005" } }), await db.account.findUnique({ where: { characterId: "c0006" } })];
await db.account.update({ where: { id: a5.id }, data: { balance: { decrement: 100000n } } }); await db.account.update({ where: { id: a6.id }, data: { balance: { decrement: 100000n } } });
await db.ledgerEntry.createMany({ data: [{ idempotencyKey: "e:5", debitAccountId: a5.id, creditAccountId: house.id, amount: 100000n, memo: "escrow", gameWeek: 1 }, { idempotencyKey: "e:6", debitAccountId: a6.id, creditAccountId: house.id, amount: 100000n, memo: "escrow", gameWeek: 1 }] });
const m = await db.gameMatch.create({ data: { game: "LUDO", mode: "FRIEND", status: "ACTIVE", hostId: "c0005", guestId: "c0006", stakeKobo: 100000n, state: {}, startedAt: new Date() } });
await G.gameAction(db, A, "match.void", { matchId: m.id.toString(), reason: R, requestId: rid("mv") });
ok((await db.account.findUnique({ where: { characterId: "c0005" } })).balance === a5.balance && (await db.account.findUnique({ where: { characterId: "c0006" } })).balance === a6.balance, "both wagers returned exactly");
ok((await db.gameMatch.findUnique({ where: { id: m.id } })).status === "VOID", "match voided");
await err(() => G.gameAction(db, A, "match.void", { matchId: m.id.toString(), reason: R, requestId: rid("mv") }), /already over/, "void twice refused");
// billboard
const bb = await db.billboardSlot.findFirst(); await G.gameAction(db, A, "billboard.hide", { id: bb.id, hidden: true, reason: R, requestId: rid("bh") }); ok((await db.billboardSlot.findUnique({ where: { id: bb.id } })).hidden === true, "poster switched off");
await err(() => G.gameAction(db, A, "unknown.action", { reason: R }), /Unknown action/, "unknown action");
const rules = G.gameRules(); ok(rules.sections.length >= 10 && JSON.stringify(rules).length > 2000, "rules snapshot: " + rules.sections.length + " sections");
const au = await db.auditLog.count({ where: { action: { startsWith: "GAME:" }, status: "OK" } }); ok(au >= 9, "game actions audited: " + au);
console.log(`\n${pass} passed, ${fail} failed`); await db.end(); process.exit(fail ? 1 : 0);
