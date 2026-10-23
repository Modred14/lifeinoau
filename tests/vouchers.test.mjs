// Voucher claims: FCFS concurrency, per-player limits, idempotency and pool/bank atomicity.
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
import { redeemVoucher, createVoucher, VoucherError } from "../lib/voucherService.js";

const t0 = new Date("2026-10-23T12:00:00Z"), future = new Date("2026-10-24T12:00:00Z");
const db = makeDb(["voucher", "voucherRedemption", "character", "account", "ledgerEntry", "gameClock", "auditLog"], {
  unique: { voucher: ["codeHash"], voucherRedemption: ["requestId"], ledgerEntry: ["idempotencyKey"] },
  defaults: { gameClock: { startedAt: t0 }, voucher: { claimedWinners: 0, status: "DRAFT", fundedAt: null, createdAt: t0 } },
  join: { character: (c, T) => c && ({ ...c, account: T.account.find((a) => a.id === c.accountId) ?? null }) },
});
const T = db.T();
T.gameClock.push({ id: 1, startedAt: t0 });
T.account.push({ id: "world", kind: "SYSTEM", systemName: "WORLD", balance: 0n });
T.account.push({ id: "vouchers", kind: "SYSTEM", systemName: "VOUCHERS", balance: 0n });
for (let i = 1; i <= 5; i++) {
  T.account.push({ id: `acct${i}`, kind: "PLAYER", balance: 500_000n });
  T.character.push({ id: `char${i}`, userId: `user${i}`, accountId: `acct${i}` });
}
const voucher = (overrides = {}) => ({ id: 100n, label: "Welcome Drop", codeHash: "hash", rewardKobo: 1_000_000n, totalPoolKobo: 2_000_000n, remainingPoolKobo: 2_000_000n, maxWinners: 2, claimedWinners: 0, maxPerPlayer: 1, startsAt: t0, endsAt: future, status: "ACTIVE", fundedAt: t0, createdBy: "admin", ...overrides });
T.voucher.push(voucher());
// Use the real hash function indirectly by creating a draft and reading the stored digest only in this trusted unit test.
const draft = await createVoucher(db, "admin", { label: "Private code", rewardNaira: "1000", totalPoolNaira: "10000", maxWinners: 10, startsAt: t0, endsAt: future });
assert.ok(draft.code.startsWith("OAU-"));
assert.notEqual(T.voucher.find((v) => v.id !== 100n).codeHash, draft.code);
await assert.rejects(createVoucher(db, "admin", { label: "Bad amount", rewardNaira: "-1", totalPoolNaira: "10000", maxWinners: 1, startsAt: t0, endsAt: future }), VoucherError);
await assert.rejects(createVoucher(db, "admin", { label: "Short pool", rewardNaira: "10000", totalPoolNaira: "1", maxWinners: 2, startsAt: t0, endsAt: future }), VoucherError);

// Queue transactions like the voucher row lock in PostgreSQL; the claims still execute concurrently at the API boundary.
const tx = db.$transaction;
let queue = Promise.resolve();
db.$transaction = async (work, options) => {
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  const prior = queue; queue = prior.then(() => next); await prior;
  try { return await tx(work, options); } finally { release(); }
};
const req = (i) => `request-${i}-123456`;
// Replace the service's code hash fixture with the digest of this exact code by asking the draft generator to provide one.
const claimDraft = await createVoucher(db, "admin", { label: "Concurrency Drop", rewardNaira: "10000", totalPoolNaira: "20000", maxWinners: 2, startsAt: t0, endsAt: future });
const claimVoucher = T.voucher.find((v) => v.id !== 100n && v.label === "Concurrency Drop");
const { createHash } = await import("node:crypto");
claimVoucher.codeHash = createHash("sha256").update(claimDraft.code.toUpperCase().replace(/[\s-]/g, "")).digest("hex");
claimVoucher.status = "ACTIVE"; claimVoucher.fundedAt = t0;

const concurrent = await Promise.all([1, 2, 3, 4].map((i) => redeemVoucher(db, `user${i}`, { code: claimDraft.code, requestId: req(i), payoutKobo: "1", balance: "999999999999999" }, t0).then((r) => ({ i, r }), (e) => ({ i, e }))));
const winners = concurrent.filter((x) => x.r).sort((a, b) => a.r.ordinal - b.r.ordinal);
assert.equal(winners.length, 2, "only the first two concurrent requests should win");
assert.deepEqual(winners.map((x) => x.i), [1, 2], "winner ordinal follows serialized request arrival order");
assert.equal(claimVoucher.claimedWinners, 2);
assert.equal(claimVoucher.remainingPoolKobo, 0n);
assert.equal(claimVoucher.status, "EXHAUSTED");
assert.equal(T.voucherRedemption.length, 2);
assert.equal(T.ledgerEntry.filter((r) => r.memo === "Voucher reward: Concurrency Drop").length, 2);
assert.equal(T.account.find((a) => a.id === "acct1").balance, 1_500_000n);
assert.equal(T.account.find((a) => a.id === "acct2").balance, 1_500_000n);
assert.ok(concurrent.filter((x) => x.e).every((x) => x.e instanceof VoucherError && x.e.status === 409));

const replay = await redeemVoucher(db, "user1", { code: claimDraft.code, requestId: req(1) }, t0);
assert.equal(replay.duplicate, true);
assert.equal(T.account.find((a) => a.id === "acct1").balance, 1_500_000n, "replay must not pay twice");
assert.equal(await rejected(redeemVoucher(db, "user1", { code: claimDraft.code, requestId: "request-new-123456" }, t0), 409), true, "a player cannot claim the same voucher twice by default");
assert.equal(await rejected(redeemVoucher(db, "user5", { code: "OAU-not-a-real-code-0000", requestId: req(5) }, t0), 404), true, "invalid codes are rejected");

const expired = voucher({ id: 101n, codeHash: "expiredhash", endsAt: new Date(t0.getTime() - 1) });
T.voucher.push(expired);
const expiredCode = await createVoucher(db, "admin", { label: "Expired Drop", rewardNaira: "100", totalPoolNaira: "100", maxWinners: 1, startsAt: new Date(t0.getTime() - 1000), endsAt: new Date(t0.getTime() + 1000) });
const expiredRow = T.voucher.find((v) => v.label === "Expired Drop"); expiredRow.status = "ACTIVE"; expiredRow.fundedAt = t0;
expiredRow.endsAt = new Date(t0.getTime() - 1);
expiredRow.codeHash = createHash("sha256").update(expiredCode.code.toUpperCase().replace(/[\s-]/g, "")).digest("hex");
assert.equal(await rejected(redeemVoucher(db, "user5", { code: expiredCode.code, requestId: "expired-request-123" }, t0), 410), true, "expired vouchers cannot pay");

const dry = voucher({ id: 102n, codeHash: "dryhash", remainingPoolKobo: 999_999n, maxWinners: 2, claimedWinners: 0 });
T.voucher.push(dry);
const dryCode = await createVoucher(db, "admin", { label: "Dry Drop", rewardNaira: "10000", totalPoolNaira: "20000", maxWinners: 2, startsAt: t0, endsAt: future });
const dryRow = T.voucher.find((v) => v.label === "Dry Drop"); dryRow.status = "ACTIVE"; dryRow.fundedAt = t0; dryRow.remainingPoolKobo = 999_999n;
dryRow.codeHash = createHash("sha256").update(dryCode.code.toUpperCase().replace(/[\s-]/g, "")).digest("hex");
const before = T.account.find((a) => a.id === "acct5").balance;
assert.equal(await rejected(redeemVoucher(db, "user5", { code: dryCode.code, requestId: "dry-request-123456" }, t0), 409), true, "a payout cannot exceed the pool balance");
assert.equal(T.account.find((a) => a.id === "acct5").balance, before, "a rejected short pool cannot credit a player");

function rejected(p, status) { return p.then(() => false, (e) => e instanceof VoucherError && e.status === status); }
console.log("Voucher concurrency, exhaustion, invalid, duplicate, expiry and insufficient-pool checks passed.");
