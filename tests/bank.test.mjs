// tests/bank.test.mjs: the Bank's pure rules (lib/bankRules.js) and how it joins the rest of the game. No database.
import assert from "node:assert/strict";
import { BANK, parseNaira, cleanGoalName, netWorthOf, splitSavings, goalPct, accountNumber, cardTierOf, describeEntry, HISTORY_FILTERS } from "../lib/bankRules.js";
import { FEATURES } from "../lib/features.js";
import { readFileSync } from "node:fs";

// amounts: whole naira, within limits, never a float or a string that is not plain digits
assert.deepEqual(parseNaira("1000"), { n: 1000 }); assert.deepEqual(parseNaira(500), { n: 500 }); assert.deepEqual(parseNaira(" 250 "), { n: 250 });
for (const bad of [0, 99, -5, 1.5, "1.5", "1e3", "abc", "", null, undefined, {}, [], "10,000", "-100", "0x10", 1_000_000_001, "٣٠٠", NaN, Infinity]) assert.ok(parseNaira(bad).error, `refuses ${String(bad)}`);
assert.ok(parseNaira(BANK.maxNaira).n && parseNaira(BANK.maxNaira + 1).error);
assert.ok(parseNaira(10, { min: 1, max: 20 }).n === 10 && parseNaira(21, { min: 1, max: 20 }).error);
assert.equal(cleanGoalName("  New \u0007  laptop  "), "New laptop"); assert.equal(cleanGoalName("   "), null); assert.equal(cleanGoalName("x".repeat(80)).length, BANK.nameMax);

// net worth: every part once, savings included, negatives never counted
const nw = netWorthOf({ cash: 4_000_000n, savings: 1_000_000n, business: 500_000n, investments: 250_000n });
assert.equal(nw.total, 5_750_000n); assert.deepEqual([nw.cash, nw.savings, nw.business, nw.investments], [4_000_000n, 1_000_000n, 500_000n, 250_000n]);
assert.equal(netWorthOf({ cash: 5_000_000n }).total, netWorthOf({ cash: 4_000_000n, savings: 1_000_000n }).total, "moving money into savings never changes net worth");
assert.equal(netWorthOf({ cash: -5n, savings: 10n }).total, 10n); assert.equal(netWorthOf().total, 0n); assert.equal(netWorthOf({ cash: "7", savings: 3 }).total, 10n);

// savings goals only set aside what is there
const goals = [{ savedKobo: 300n, status: "ACTIVE" }, { savedKobo: 200n, status: "ACHIEVED" }, { savedKobo: 999n, status: "CLOSED" }];
assert.deepEqual(splitSavings(1_000n, goals), { balance: 1_000n, earmarked: 500n, free: 500n });
assert.equal(splitSavings(100n, goals).free, 0n, "never negative");
assert.equal(goalPct({ savedKobo: 0n, targetKobo: 1000n }), 0); assert.equal(goalPct({ savedKobo: 999n, targetKobo: 1000n }), 99); assert.equal(goalPct({ savedKobo: 5000n, targetKobo: 1000n }), 100); assert.equal(goalPct({ savedKobo: 5n, targetKobo: 0n }), 0);

// the card
assert.match(accountNumber("c123"), /^\d{10}$/); assert.equal(accountNumber("c123"), accountNumber("c123")); assert.notEqual(accountNumber("c123"), accountNumber("c124"));
assert.deepEqual(["LAPO", "MAPO", "NEPO", "?"].map(cardTierOf), ["Classic", "Gold", "Platinum", "Classic"]);

// the statement reads each ledger row from the account's own side
const row = (o) => ({ id: 7n, amount: 500_000n, createdAt: new Date(0), memo: "", idempotencyKey: "", debitAccountId: "me", creditAccountId: "x", ...o });
assert.deepEqual(describeEntry(row({ creditAccountId: "sv" }), "me", { systemName: "SAVINGS" }).title, "Moved to savings");
assert.equal(describeEntry(row({ debitAccountId: "sv", creditAccountId: "me" }), "me", { systemName: "SAVINGS" }).title, "Withdrawn from savings");
const out = describeEntry(row({ idempotencyKey: "p2p:me:r1", memo: "To Ben: for food" }), "me", { character: { name: "Ben" } });
assert.deepEqual([out.title, out.detail, out.direction, out.category], ["Sent to Ben", "for food", "out", "transfer"]);
const inn = describeEntry(row({ debitAccountId: "ben", creditAccountId: "me", idempotencyKey: "p2p:ben:r1", memo: "To Ada: for food" }), "me", { character: { name: "Ben" } });
assert.deepEqual([inn.title, inn.direction], ["Received from Ben", "in"]);
assert.equal(describeEntry(row({ idempotencyKey: "fee:me:r1", memo: "Transfer fee" }), "me", { systemName: "WORLD" }).category, "fee");
assert.equal(describeEntry(row({ debitAccountId: "parents", creditAccountId: "me", memo: "Gift from parent" }), "me", { systemName: "PARENTS" }).category, "family");
assert.equal(typeof describeEntry(row(), "me", null).amountKobo, "string", "amounts reach the browser as text: a BigInt cannot be sent as JSON");
assert.ok(HISTORY_FILTERS.includes("all") && HISTORY_FILTERS.includes("savings"));

// the Bank is registered in the Guide, and the three places that compute net worth all count savings
assert.ok(FEATURES.find((f) => f.id === "app.bank" && f.api.includes("/api/bank")));
for (const f of ["lib/leaderboards.js", "lib/adminForbes.js", "lib/adminPlayers.js"]) assert.ok(readFileSync(new URL(`../${f}`, import.meta.url), "utf8").includes('"SavingsAccount"'), `${f} counts savings in net worth`);
assert.ok(readFileSync(new URL("../lib/gameService.js", import.meta.url), "utf8").includes("netWorthOf("), "the profile uses the shared net worth");
assert.ok(readFileSync(new URL("../lib/newLifeService.js", import.meta.url), "utf8").includes("savingsAccount"), "a New Life gives savings back through the ledger");
console.log("bank rules: ok");
