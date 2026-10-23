// Vouchers use the same kobo ledger as every other game payout. A locked voucher row
// assigns winner ordinals in FCFS order and reserves its pool in the very same transaction.
import { createHash, randomBytes } from "node:crypto";
import { transferInTx } from "./ledger.js";
import { currentWeek } from "./clock.js";

export class VoucherError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const MAX_WINNERS = 100_000;
const normalizeCode = (code) => String(code ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
const codeHash = (code) => createHash("sha256").update(normalizeCode(code)).digest("hex");
const randomCode = () => `OAU-${randomBytes(16).toString("hex").toUpperCase().match(/.{1,4}/g).join("-")}`;
const moneyKobo = (v, name) => {
  const raw = String(v ?? "").trim();
  if (!/^\d{1,15}$/.test(raw) || BigInt(raw) <= 0n) throw new VoucherError(`${name} must be a positive whole-naira amount.`);
  return BigInt(raw) * 100n;
};
const countValue = (v, name, { optional = false } = {}) => {
  if (optional && v == null) return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_WINNERS) throw new VoucherError(`${name} must be between 1 and ${MAX_WINNERS}.`);
  return n;
};
const dateValue = (v, name) => {
  const d = new Date(v);
  if (!v || !Number.isFinite(d.getTime())) throw new VoucherError(`${name} must be a valid date.`);
  return d;
};
const safeVoucher = (v) => ({
  id: v.id, label: v.label, rewardKobo: String(v.rewardKobo), totalPoolKobo: String(v.totalPoolKobo),
  remainingPoolKobo: String(v.remainingPoolKobo), maxWinners: v.maxWinners, claimedWinners: v.claimedWinners,
  remainingWinners: Math.max(0, v.maxWinners - v.claimedWinners), maxPerPlayer: v.maxPerPlayer,
  startsAt: v.startsAt, endsAt: v.endsAt, status: v.status, fundedAt: v.fundedAt, createdAt: v.createdAt,
});
const retryable = (e) => ["P2034", "P2002"].includes(e?.code);

async function transactionWithRetry(db, work) {
  for (let attempt = 0; ; attempt++) {
    // The explicit voucher row FOR UPDATE is the serializer. READ COMMITTED lets each waiter
    // observe the just-committed winner count after the lock releases, avoiding serialization
    // failures for large simultaneous drops while retaining the atomic ledger transaction.
    try { return await db.$transaction(work, { isolationLevel: "ReadCommitted", maxWait: 15_000, timeout: 60_000 }); }
    catch (e) { if (!retryable(e) || attempt >= 4) throw e; }
  }
}

function configFrom(input, existing = null) {
  const label = String(input.label ?? existing?.label ?? "").trim().replace(/[<>]/g, "").slice(0, 80);
  if (!label) throw new VoucherError("Give this voucher a name.");
  const rewardKobo = input.rewardNaira === undefined && existing ? existing.rewardKobo : moneyKobo(input.rewardNaira, "Reward per player");
  const totalPoolKobo = input.totalPoolNaira === undefined && existing ? existing.totalPoolKobo : moneyKobo(input.totalPoolNaira, "Total pool");
  const maxWinners = input.maxWinners === undefined && existing ? existing.maxWinners : countValue(input.maxWinners, "Winner limit");
  if (totalPoolKobo < rewardKobo * BigInt(maxWinners)) throw new VoucherError("The total pool must cover every configured winner.");
  const maxPerPlayer = input.maxPerPlayer === undefined && existing ? existing.maxPerPlayer : input.maxPerPlayer === undefined ? 1 : countValue(input.maxPerPlayer, "Per-player limit", { optional: true });
  if (maxPerPlayer != null && maxPerPlayer > maxWinners) throw new VoucherError("The per-player limit cannot exceed the winner limit.");
  const startsAt = input.startsAt === undefined && existing ? existing.startsAt : dateValue(input.startsAt, "Start date");
  const endsAt = input.endsAt === undefined && existing ? existing.endsAt : dateValue(input.endsAt, "End date");
  if (endsAt <= startsAt) throw new VoucherError("The end date must be after the start date.");
  return { label, rewardKobo, totalPoolKobo, maxWinners, maxPerPlayer, startsAt, endsAt };
}

/** Create a draft. The random code is returned once and only its SHA-256 hash is persisted. */
export async function createVoucher(db, adminId, input = {}) {
  const config = configFrom(input), code = randomCode();
  const voucher = await transactionWithRetry(db, async (tx) => {
    const v = await tx.voucher.create({ data: { ...config, codeHash: codeHash(code), remainingPoolKobo: config.totalPoolKobo, createdBy: adminId, status: "DRAFT" } });
    await tx.auditLog.create({ data: { actorId: adminId, action: "VOUCHER_CREATE", target: v.id, detail: { label: v.label, rewardKobo: String(v.rewardKobo), maxWinners: v.maxWinners, totalPoolKobo: String(v.totalPoolKobo) } } });
    return v;
  });
  return { voucher: safeVoucher(voucher), code };
}

/** Reconfigure only an unactivated draft, before any pool has been funded or claimed. */
export async function configureVoucher(db, adminId, id, input = {}) {
  if (typeof id !== "string" || !id || id.length > 80) throw new VoucherError("Voucher not found.", 404);
  return transactionWithRetry(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Voucher" WHERE id = ${id} FOR UPDATE`;
    const old = await tx.voucher.findUnique({ where: { id } });
    if (!old) throw new VoucherError("Voucher not found.", 404);
    if (old.status !== "DRAFT" || old.fundedAt || old.claimedWinners) throw new VoucherError("Only an unfunded draft can be configured.", 409);
    const config = configFrom(input, old);
    const v = await tx.voucher.update({ where: { id }, data: { ...config, remainingPoolKobo: config.totalPoolKobo } });
    await tx.auditLog.create({ data: { actorId: adminId, action: "VOUCHER_CONFIGURE", target: id, detail: { rewardKobo: String(v.rewardKobo), maxWinners: v.maxWinners, totalPoolKobo: String(v.totalPoolKobo), maxPerPlayer: v.maxPerPlayer } } });
    return safeVoucher(v);
  });
}

/** Fund the reserved pool and activate it atomically. Re-activation never funds it twice. */
export async function setVoucherActive(db, adminId, id, active) {
  if (typeof id !== "string" || !id || id.length > 80 || typeof active !== "boolean") throw new VoucherError("Invalid voucher action.");
  return transactionWithRetry(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Voucher" WHERE id = ${id} FOR UPDATE`;
    const v = await tx.voucher.findUnique({ where: { id } });
    if (!v) throw new VoucherError("Voucher not found.", 404);
    if (active) {
      if (v.status === "EXHAUSTED") throw new VoucherError("This voucher has already been exhausted.", 409);
      if (v.endsAt <= new Date()) throw new VoucherError("This voucher has expired.", 409);
      if (!v.fundedAt) {
        const [world, pool] = await Promise.all([
          tx.account.findUnique({ where: { systemName: "WORLD" } }),
          tx.account.upsert({ where: { systemName: "VOUCHERS" }, create: { kind: "SYSTEM", systemName: "VOUCHERS" }, update: {} }),
        ]);
        if (!world) throw new VoucherError("The game economy is not ready. Contact an administrator.", 500);
        await transferInTx(tx, { fromId: world.id, toId: pool.id, amount: v.totalPoolKobo, memo: `Voucher pool: ${v.label}`, key: `voucher:fund:${v.id}`, week: await currentWeek(tx) });
      }
      const updated = await tx.voucher.update({ where: { id }, data: { status: "ACTIVE", fundedAt: v.fundedAt ?? new Date() } });
      await tx.auditLog.create({ data: { actorId: adminId, action: "VOUCHER_ACTIVATE", target: id, detail: { label: v.label } } });
      return safeVoucher(updated);
    }
    if (v.status === "EXHAUSTED") throw new VoucherError("An exhausted voucher cannot be reactivated or paused.", 409);
    if (v.status === "DRAFT" || v.status === "PAUSED") return safeVoucher(v);
    const updated = await tx.voucher.update({ where: { id }, data: { status: "PAUSED" } });
    await tx.auditLog.create({ data: { actorId: adminId, action: "VOUCHER_DEACTIVATE", target: id, detail: { label: v.label } } });
    return safeVoucher(updated);
  });
}

export async function listVouchers(db) {
  const rows = await db.voucher.findMany({ orderBy: { createdAt: "desc" }, include: { redemptions: { orderBy: { createdAt: "desc" }, take: 25, include: { character: { select: { id: true, name: true } } } } } });
  return rows.map((v) => ({ ...safeVoucher(v), recentRedemptions: v.redemptions.map((r) => ({ id: String(r.id), player: r.character.name, payoutKobo: String(r.payoutKobo), ordinal: r.ordinal, createdAt: r.createdAt })) }));
}

export async function playerVoucherState(db, userId, now = new Date()) {
  const ch = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!ch) throw new VoucherError("Create a character first.", 404);
  const [rows, history] = await Promise.all([
    db.voucher.findMany({ where: { status: { in: ["ACTIVE", "EXHAUSTED"] } }, orderBy: { startsAt: "asc" } }),
    db.voucherRedemption.findMany({ where: { characterId: ch.id }, orderBy: { createdAt: "desc" }, take: 25, include: { voucher: { select: { label: true } } } }),
  ]);
  const vouchers = rows.map((v) => {
    let status = v.status.toLowerCase();
    if (v.status === "ACTIVE" && now < v.startsAt) status = "scheduled";
    else if (v.status === "ACTIVE" && now >= v.endsAt) status = "expired";
    return { id: v.id, label: v.label, rewardKobo: String(v.rewardKobo), remainingWinners: Math.max(0, v.maxWinners - v.claimedWinners), maxWinners: v.maxWinners, startsAt: v.startsAt, endsAt: v.endsAt, status };
  });
  return { vouchers, history: history.map((r) => ({ id: String(r.id), label: r.voucher.label, payoutKobo: String(r.payoutKobo), ordinal: r.ordinal, createdAt: r.createdAt })) };
}

const resultFor = (v, redemption, duplicate = false) => ({
  ok: true, duplicate, label: v.label, payoutKobo: String(redemption.payoutKobo), ordinal: redemption.ordinal,
  remainingWinners: Math.max(0, v.maxWinners - v.claimedWinners), remainingPoolKobo: String(v.remainingPoolKobo), status: v.status,
});

/** Claim one FCFS place. Locking the voucher row serializes all claimants before choosing the winner ordinal. */
export async function redeemVoucher(db, userId, { code, requestId } = {}, now = new Date()) {
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new VoucherError("Refresh the app and try again.");
  const normalized = normalizeCode(code);
  if (normalized.length < 12 || normalized.length > 80 || !/^[A-Z0-9]+$/.test(normalized)) throw new VoucherError("Enter a valid voucher code.", 400);
  const hash = codeHash(normalized);
  return transactionWithRetry(db, async (tx) => {
    const ch = await tx.character.findUnique({ where: { userId }, include: { account: true } });
    if (!ch?.account) throw new VoucherError("Create a character first.", 404);
    let voucher = await tx.voucher.findUnique({ where: { codeHash: hash } });
    if (!voucher) throw new VoucherError("That voucher code is invalid.", 404);
    await tx.$queryRaw`SELECT id FROM "Voucher" WHERE id = ${voucher.id} FOR UPDATE`;
    voucher = await tx.voucher.findUnique({ where: { id: voucher.id } });
    const replay = await tx.voucherRedemption.findUnique({ where: { requestId } });
    if (replay) {
      if (replay.characterId !== ch.id || replay.voucherId !== voucher.id) throw new VoucherError("This redemption request was already used.", 409);
      return resultFor(voucher, replay, true);
    }
    if (voucher.status === "PAUSED" || voucher.status === "DRAFT") throw new VoucherError("This voucher is not active.", 409);
    if (voucher.status === "EXHAUSTED" || voucher.claimedWinners >= voucher.maxWinners) throw new VoucherError("This voucher has been fully claimed.", 409);
    if (now < voucher.startsAt) throw new VoucherError("This voucher is not available yet.", 409);
    if (now >= voucher.endsAt) throw new VoucherError("This voucher has expired.", 410);
    if (!voucher.fundedAt) throw new VoucherError("This voucher is not ready yet.", 409);
    if (voucher.remainingPoolKobo < voucher.rewardKobo) throw new VoucherError("This voucher has no reward funds remaining.", 409);
    const priorCount = await tx.voucherRedemption.count({ where: { voucherId: voucher.id, characterId: ch.id } });
    if (voucher.maxPerPlayer != null && priorCount >= voucher.maxPerPlayer) throw new VoucherError("You have already used your limit for this voucher.", 409);
    const pool = await tx.account.findUnique({ where: { systemName: "VOUCHERS" } });
    if (!pool) throw new VoucherError("Voucher payout is temporarily unavailable.", 500);
    const ordinal = voucher.claimedWinners + 1, playerUse = priorCount + 1;
    const entry = await transferInTx(tx, { fromId: pool.id, toId: ch.account.id, amount: voucher.rewardKobo, memo: `Voucher reward: ${voucher.label}`, key: `voucher:claim:${requestId}`, week: await currentWeek(tx) });
    const redemption = await tx.voucherRedemption.create({ data: { voucherId: voucher.id, characterId: ch.id, payoutKobo: voucher.rewardKobo, ordinal, playerUse, requestId, ledgerEntryId: entry.id } });
    const claimedWinners = ordinal, remainingPoolKobo = voucher.remainingPoolKobo - voucher.rewardKobo;
    const updated = await tx.voucher.update({ where: { id: voucher.id }, data: { claimedWinners, remainingPoolKobo, status: claimedWinners >= voucher.maxWinners ? "EXHAUSTED" : "ACTIVE" } });
    return resultFor(updated, redemption);
  });
}
