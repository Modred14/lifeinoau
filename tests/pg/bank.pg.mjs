// tests/pg/bank.pg.mjs: the Bank app against a real PostgreSQL database (see tests/pg/bankHarness.mjs for how to run it).
import { db, makeClient, reset, player, rq, balance, savings, naira, denied, books, assert, ok, done } from "./bankHarness.mjs";
import { deposit, withdraw, createGoal, fundGoal, closeGoal, getBank, getHistory, bankAction, verifySavings } from "../../lib/bankService.js";
import { getProfile } from "../../lib/gameService.js";
import { getBoard, clearBoardCache } from "../../lib/leaderboards.js";

await reset();
const pk = (r) => BigInt(r);

// ---------- deposits and withdrawals ----------
const ada = await player("Ada", { balanceNaira: 50_000 }), bob = await player("Bob", { balanceNaira: 1_000 });
let r = await deposit(db, ada.uid, { amountNaira: 10_000, requestId: rq() });
assert.equal(r.ok, true); assert.equal(await balance(ada), naira(40_000)); assert.equal(await savings(ada), naira(10_000));
ok("deposit moves money from the spendable balance into savings");
let b = await getBank(db, ada.uid);
assert.equal(b.availableKobo, naira(40_000).toString()); assert.equal(b.savingsKobo, naira(10_000).toString());
assert.equal(b.netWorth.totalKobo, naira(50_000).toString(), "saving money must not change net worth");
ok("net worth is unchanged by saving (no double count, nothing lost)", `(₦${Number(pk(b.netWorth.totalKobo) / 100n).toLocaleString()})`);
r = await withdraw(db, ada.uid, { amountNaira: 4_000, requestId: rq() });
assert.equal(await balance(ada), naira(44_000)); assert.equal(await savings(ada), naira(6_000));
ok("withdraw returns savings to the spendable balance");
await books();

// ---------- refusals ----------
await denied("overdraft deposit", () => deposit(db, bob.uid, { amountNaira: 5_000, requestId: rq() }), /not have enough money/i, 402);
assert.equal(await balance(bob), naira(1_000)); assert.equal(await savings(bob), 0n);
await denied("withdraw more than saved", () => withdraw(db, ada.uid, { amountNaira: 6_001, requestId: rq() }), /Only ₦6,000 of your savings is free/i, 409);
await denied("withdraw with no savings", () => withdraw(db, bob.uid, { amountNaira: 100, requestId: rq() }), /no savings/i, 409);
for (const bad of [0, -5, 99, 1.5, "abc", "1e9", "", null, undefined, {}, [], "10 000", 1_000_000_001, "٣٠٠"])
  await denied(`amount ${JSON.stringify(bad)}`, () => deposit(db, ada.uid, { amountNaira: bad, requestId: rq() }), /whole amount|between/i, 400);
await denied("missing requestId", () => deposit(db, ada.uid, { amountNaira: 500 }), /requestId/i);
await denied("unknown action", () => bankAction(db, ada.uid, { action: "mint" }), /Unknown action/i);
assert.equal(await balance(ada), naira(44_000)); assert.equal(await savings(ada), naira(6_000));
ok("nothing moved on any refused request");

// ---------- idempotency ----------
const same = rq();
const first = await deposit(db, ada.uid, { amountNaira: 1_000, requestId: same });
const again = await deposit(db, ada.uid, { amountNaira: 1_000, requestId: same });
assert.equal(again.duplicate, true); assert.equal(first.duplicate, undefined);
assert.equal(await savings(ada), naira(7_000));
ok("a repeated request id is answered 'duplicate' and moves nothing twice");
const burst = rq();
const results = await Promise.all(Array.from({ length: 12 }, () => deposit(db, ada.uid, { amountNaira: 1_000, requestId: burst })));
assert.equal(results.filter((x) => !x.duplicate).length, 1); assert.equal(await savings(ada), naira(8_000));
ok("12 simultaneous taps with one request id make exactly one deposit");

// ---------- concurrency: never negative, never more than there is ----------
const cy = await player("Cy", { balanceNaira: 10_000 });
const deps = await Promise.allSettled(Array.from({ length: 6 }, () => deposit(db, cy.uid, { amountNaira: 4_000, requestId: rq() })));
assert.equal(deps.filter((x) => x.status === "fulfilled").length, 2, "only two 4,000 deposits fit in 10,000");
assert.equal(await balance(cy), naira(2_000)); assert.equal(await savings(cy), naira(8_000));
ok("6 racing deposits of ₦4,000 from ₦10,000: exactly 2 succeed, balance never negative");
const wds = await Promise.allSettled(Array.from({ length: 6 }, () => withdraw(db, cy.uid, { amountNaira: 3_000, requestId: rq() })));
assert.equal(wds.filter((x) => x.status === "fulfilled").length, 2, "only two 3,000 withdrawals fit in 8,000");
assert.equal(await savings(cy), naira(2_000)); assert.equal(await balance(cy), naira(8_000));
ok("6 racing withdrawals of ₦3,000 from ₦8,000 savings: exactly 2 succeed");
await books();

// ---------- savings goals ----------
const dee = await player("Dee", { balanceNaira: 100_000 });
await denied("goal without a name", () => createGoal(db, dee.uid, { name: "   ", targetNaira: 5_000, requestId: rq() }), /name/i);
await denied("goal target too small", () => createGoal(db, dee.uid, { name: "x", targetNaira: 10, requestId: rq() }), /between/i);
const laptop = (await createGoal(db, dee.uid, { name: "  New \u0007 laptop  ", targetNaira: 20_000, requestId: rq() })).goal;
assert.equal(laptop.name, "New laptop"); assert.equal(laptop.pct, 0);
ok("a goal is created with a cleaned name and 0% progress");
await deposit(db, dee.uid, { amountNaira: 8_000, goalId: laptop.id, requestId: rq() });
b = await getBank(db, dee.uid);
assert.equal(b.goals[0].savedKobo, naira(8_000).toString()); assert.equal(b.goals[0].pct, 40);
assert.equal(b.savingsKobo, naira(8_000).toString()); assert.equal(b.freeSavingsKobo, "0"); assert.equal(b.setAsideKobo, naira(8_000).toString());
ok("saving into a goal sets the money aside and tracks progress (40%)");
await denied("withdraw money that is set aside for a goal", () => withdraw(db, dee.uid, { amountNaira: 100, requestId: rq() }), /set aside for goals/i, 409);
await deposit(db, dee.uid, { amountNaira: 5_000, requestId: rq() });
await denied("withdraw more than the free savings", () => withdraw(db, dee.uid, { amountNaira: 5_001, requestId: rq() }), /Only ₦5,000 of your savings is free/i, 409);
await fundGoal(db, dee.uid, { goalId: laptop.id, amountNaira: 2_000, requestId: rq() });
b = await getBank(db, dee.uid); assert.equal(b.goals[0].pct, 50); assert.equal(b.freeSavingsKobo, naira(3_000).toString());
assert.equal(b.availableKobo, naira(87_000).toString()); // funding a goal moves no money
ok("setting savings aside for a goal moves no money");
await denied("fund more than free", () => fundGoal(db, dee.uid, { goalId: laptop.id, amountNaira: 3_001, requestId: rq() }), /free to set aside/i, 409);
await denied("fund more than the goal needs", () => fundGoal(db, dee.uid, { goalId: laptop.id, amountNaira: 100_000, requestId: rq() }), /free to set aside|only needs/i, 409);
const sent = await deposit(db, dee.uid, { amountNaira: 30_000, goalId: laptop.id, requestId: rq() });
b = await getBank(db, dee.uid);
assert.equal(sent.setAsideKobo, naira(10_000).toString(), "only what the goal still needs is set aside");
assert.equal(b.goals[0].status, "ACHIEVED"); assert.equal(b.goals[0].pct, 100);
assert.ok((await db.notification.findMany({ where: { characterId: dee.id } })).some((n) => /Goal reached/.test(n.body)));
ok("a goal is achieved when it reaches its target, the overflow stays free, and the player is told");
const part = await withdraw(db, dee.uid, { amountNaira: 5_000, goalId: laptop.id, requestId: rq() });
b = await getBank(db, dee.uid); assert.equal(b.goals[0].status, "ACTIVE"); assert.equal(b.goals[0].pct, 75);
ok("withdrawing from a goal takes that goal's money and reopens it");
for (let i = 0; i < 4; i++) await createGoal(db, dee.uid, { name: `Goal ${i}`, targetNaira: 5_000, requestId: rq() });
await denied("a sixth open goal", () => createGoal(db, dee.uid, { name: "Too many", targetNaira: 5_000, requestId: rq() }), /5 savings goals/i, 409);
const closed = await closeGoal(db, dee.uid, { goalId: laptop.id, requestId: rq() });
b = await getBank(db, dee.uid);
assert.equal(closed.releasedKobo, naira(15_000).toString()); assert.equal(b.goals.length, 4);
assert.equal(b.savingsKobo, b.freeSavingsKobo, "closing a goal frees its money, it does not move it");
ok("closing a goal frees what was set aside without moving money");
const cg = await createGoal(db, dee.uid, { name: "Again", targetNaira: 5_000, requestId: rq() }); assert.ok(cg.goal);
await denied("another player's goal", () => fundGoal(db, ada.uid, { goalId: cg.goal.id, amountNaira: 100, requestId: rq() }), /not found/i, 404);
await denied("another player's goal (deposit)", () => deposit(db, ada.uid, { amountNaira: 100, goalId: cg.goal.id, requestId: rq() }), /not found/i, 404);
await denied("a goal id that is not a number", () => closeGoal(db, dee.uid, { goalId: "1; DROP TABLE x", requestId: rq() }), /Pick one of your savings goals/i);
ok("goals belong to their owner only, and ids are validated");
await books();

// ---------- the database itself refuses what the service would never do ----------
await assert.rejects(() => db.$executeRaw`UPDATE "SavingsAccount" SET "balance" = -1 WHERE "characterId" = ${ada.id}`, /nonneg|check/i);
const fay = await player("Fay", { balanceNaira: 20_000 }), fg = (await createGoal(db, fay.uid, { name: "Trip", targetNaira: 10_000, requestId: rq() })).goal;
await deposit(db, fay.uid, { amountNaira: 6_000, goalId: fg.id, requestId: rq() }); // ₦6,000 is set aside
await assert.rejects(() => db.$executeRaw`UPDATE "SavingsAccount" SET "balance" = 1000 WHERE "characterId" = ${fay.id}`, /goals hold more/i);
await assert.rejects(() => db.$executeRaw`INSERT INTO "SavingsGoal" ("characterId","name","targetKobo","savedKobo") VALUES (${ada.id}, 'x', 1000, 999999)`, /goals hold more|saved_range/i);
ok("the database rejects negative savings and goals that hold more than the savings");

// ---------- statement ----------
let h = await getHistory(db, ada.uid, {});
assert.ok(h.rows.length >= 5); assert.ok(h.rows.every((x) => x.id && x.title && x.at && /^\d+$/.test(x.amountKobo)));
const dep = h.rows.find((x) => x.title === "Moved to savings"), wd = h.rows.find((x) => x.title === "Withdrawn from savings");
assert.ok(dep && dep.direction === "out" && dep.category === "savings"); assert.ok(wd && wd.direction === "in");
ok("the statement shows savings deposits and withdrawals with direction, title and amount");
const sv = await getHistory(db, ada.uid, { filter: "savings" }); assert.ok(sv.rows.length && sv.rows.every((x) => x.category === "savings"));
const ins = await getHistory(db, ada.uid, { filter: "in" }); assert.ok(ins.rows.every((x) => x.direction === "in"));
const outs = await getHistory(db, ada.uid, { filter: "out" }); assert.ok(outs.rows.every((x) => x.direction === "out"));
const p1 = await getHistory(db, dee.uid, { limit: 3 }), p2 = await getHistory(db, dee.uid, { limit: 3, cursor: p1.next });
assert.equal(p1.rows.length, 3); assert.ok(p1.next); assert.ok(p2.rows.every((x) => BigInt(x.id) < BigInt(p1.rows[2].id)));
await denied("bad cursor", () => getHistory(db, dee.uid, { cursor: "1 OR 1=1" }), /Bad page/i);
ok("filters and pagination work, and a bad cursor is refused");
// a player-to-player transfer reads as sent / received on each statement
const { sendMoney } = await import("../../lib/gameService.js");
await sendMoney(db, ada.uid, { to: "Bob", amountNaira: 1_000, memo: "lunch", requestId: rq() });
const aSide = (await getHistory(db, ada.uid, { filter: "transfers" })).rows[0], bSide = (await getHistory(db, bob.uid, { filter: "transfers" })).rows[0];
assert.equal(aSide.title, "Sent to Bob"); assert.equal(aSide.detail, "lunch"); assert.equal(bSide.title, "Received from Ada"); assert.equal(bSide.direction, "in");
ok("transfers show as 'Sent to Bob' / 'Received from Ada' with their note");

// ---------- one net worth everywhere ----------
const eve = await player("Eve", { balanceNaira: 100_000 });
await deposit(db, eve.uid, { amountNaira: 25_000, requestId: rq() });
const { transferInTx } = await import("../../lib/ledger.js");
const acct = (await db.account.findFirst({ where: { characterId: eve.id } })).id;
const bizAcc = await db.account.findUnique({ where: { systemName: "BUSINESS" } }), mkt = await db.account.findUnique({ where: { systemName: "MARKET" } });
await transferInTx(db, { fromId: acct, toId: bizAcc.id, amount: naira(10_000), memo: "Test business capital", key: `t:biz:${rq()}`, week: 1 });
await db.business.create({ data: { characterId: eve.id, type: "tutoring", name: "Eve Ventures", capital: naira(10_000), status: "ACTIVE", startedWeek: 1, lastWeek: 1 } });
await transferInTx(db, { fromId: acct, toId: mkt.id, amount: naira(5_000), memo: "Test investment", key: `t:inv:${rq()}`, week: 1 });
const { PRODUCTS } = await import("../../lib/market.js"), product = Object.keys(PRODUCTS)[0];
await db.holding.create({ data: { characterId: eve.id, product, unitsMicro: 3_000_000n, costKobo: naira(5_000), valueKobo: naira(1), lastBuyWeek: 1 } }); // 3 units; the stored value is stale on purpose: the Bank and the board must both re-value it
const db2 = makeClient(); // its own client: the re-valuation of holdings is throttled per client, and this one has not done it yet
const nwBank = pk((await getBank(db2, eve.uid)).netWorth.totalKobo);
const profile = pk((await getProfile(db2, eve.uid, "Eve")).netWorthKobo);
clearBoardCache(); const board = await getBoard(db2, "forbes");
const row = board.rows.find((x) => x.name === "Eve");
const invested = (await db.holding.aggregate({ _sum: { valueKobo: true }, where: { characterId: eve.id } }))._sum.valueKobo;
assert.ok(invested > naira(1), "the stale holding value was re-valued at the live price");
assert.equal(nwBank, profile, "Bank and profile agree");
assert.ok(row, "Eve is on the FORBES board"); assert.equal(pk(row.value), nwBank, "FORBES agrees with the Bank");
assert.equal(nwBank, naira(100_000 - 25_000 + 25_000 - 10_000 + 10_000 - 5_000) + invested, "wallet + savings + business + investments (at the live price), each counted once");
assert.equal(pk(row.cash), naira(100_000 - 10_000 - 5_000), "the board's cash is the wallet plus the savings");
ok("Bank, profile and the FORBES board give the same net worth", `(₦${Number(nwBank / 100n).toLocaleString()}; savings counted once)`);
const before = pk((await getProfile(db2, eve.uid, "Eve")).netWorthKobo);
await deposit(db2, eve.uid, { amountNaira: 5_000, requestId: rq() }); await withdraw(db2, eve.uid, { amountNaira: 2_000, requestId: rq() });
clearBoardCache(); const after = (await getBoard(db2, "forbes")).rows.find((x) => x.name === "Eve");
assert.equal(pk((await getProfile(db2, eve.uid, "Eve")).netWorthKobo), before); assert.equal(pk(after.value), before);
ok("saving and withdrawing never move anyone's FORBES rank");

// ---------- the books ----------
await books();
const v = await verifySavings(db); assert.ok(v.ok); ok("savings held by players equal the SAVINGS account in the ledger", `(₦${Number(v.owned / 100n).toLocaleString()})`);

// ---------- New Life gives savings back through the ledger ----------
try {
  // lib/auth.js imports next/headers, which only exists inside Next: give plain Node an empty stand-in for it (only the password check is used here)
  const { register } = await import("node:module");
  register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { if (s === "next/headers") return { url: "data:text/javascript,export const cookies = async () => ({ get() {}, set() {} });", shortCircuit: true }; return n(s, c); }`));
  const { hash } = await import("../../lib/auth.js"), { startNewLife } = await import("../../lib/newLifeService.js"), { NEW_LIFE_CONFIRM } = await import("../../lib/newLifeRules.js");
  await db.user.update({ where: { id: eve.uid }, data: { passwordHash: await hash("pw-for-test") } });
  const worldBefore = await db.account.findUnique({ where: { systemName: "WORLD" } });
  await startNewLife(db, eve.uid, { password: "pw-for-test", confirm: NEW_LIFE_CONFIRM });
  assert.equal(await db.savingsAccount.count({ where: { characterId: eve.id } }), 0);
  assert.equal((await verifySavings(db)).owned, (await verifySavings(db)).ledger);
  await books();
  ok("a New Life sweeps the savings back to the world through the ledger and leaves no orphan");
} catch (e) { if (/Cannot find|ERR_MODULE|next\/headers/.test(String(e.message))) console.log("SKIP New Life (module cannot load outside Next):", e.message.split("\n")[0]); else throw e; }

await done();
