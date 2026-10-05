// lib/ledger.js
// Every money movement goes through transfer(). Nothing else may touch Account.balance.
export class InsufficientFunds extends Error {}

/** Move `amount` kobo from one account to another, atomically and idempotently.
 *  Pass a stable idempotencyKey (e.g. `allowance:${charId}:${week}`). Calling twice is safe. */
export function transfer(db, args) {
  return db.$transaction((tx) => transferInTx(tx, args), { isolationLevel: "Serializable" });
}

/** Same as transfer() but joins a transaction you already opened (used by the weekly tick).
 *  Only PLAYER accounts are locked and have a cached balance; SYSTEM account balances are derived from the ledger. */
export async function transferInTx(tx, { fromId, toId, amount, memo, key, week }) {
  amount = BigInt(amount);
  if (amount <= 0n) throw new Error("amount must be positive");
  if (fromId === toId) throw new Error("cannot transfer to self");
  const done = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
  if (done) return done; // replay: return the original result, move nothing
  const [fromA, toA] = await Promise.all([fromId, toId].map((id) => tx.account.findUnique({ where: { id } })));
  const lockIds = [fromA, toA].filter((a) => a.kind === "PLAYER").map((a) => a.id).sort(); // fixed order: no deadlocks
  if (lockIds.length) await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ANY(${lockIds}::text[]) ORDER BY id FOR UPDATE`;
  if (fromA.kind === "PLAYER") {
    const fresh = await tx.account.findUnique({ where: { id: fromId } }); // re-read after the lock
    if (fresh.balance < amount) throw new InsufficientFunds(memo);
  }
  const entry = await tx.ledgerEntry.create({ data: { idempotencyKey: key, debitAccountId: fromId, creditAccountId: toId, amount, memo, gameWeek: week } });
  if (fromA.kind === "PLAYER") await tx.account.update({ where: { id: fromId }, data: { balance: { decrement: amount } } });
  if (toA.kind === "PLAYER") await tx.account.update({ where: { id: toId }, data: { balance: { increment: amount } } });
  return entry;
}

/** Audit check for the admin panel: cached balance must equal the ledger sum. */
export async function verifyBalance(db, accountId) {
  const [r] = await db.$queryRaw`SELECT
    COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "creditAccountId"=${accountId}),0) -
    COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "debitAccountId"=${accountId}),0) AS sum`;
  const acc = await db.account.findUnique({ where: { id: accountId } });
  return { ok: BigInt(r.sum) === acc.balance, ledger: BigInt(r.sum), cached: acc.balance };
}
