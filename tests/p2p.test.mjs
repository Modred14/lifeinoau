// tests/p2p.test.mjs
import { transferInTx, InsufficientFunds } from "../lib/ledger.js";
import { feeFor, P2P, cleanText, transferCooldownRemaining } from "../lib/rules.js";
const A = {
    a: { id: "a", kind: "PLAYER", balance: 10_000_000n },
    b: { id: "b", kind: "PLAYER", balance: 0n },
    w: { id: "w", kind: "SYSTEM", balance: 0n },
  },
  L = [];
const tx = {
  $queryRaw: async () => [],
  account: {
    findUnique: async ({ where }) => ({ ...A[where.id] }),
    update: async ({ where, data }) => {
      const d = data.balance;
      if (d.decrement) A[where.id].balance -= d.decrement;
      if (d.increment) A[where.id].balance += d.increment;
    },
  },
  ledgerEntry: {
    findUnique: async ({ where }) =>
      L.find((e) => e.idempotencyKey == where.idempotencyKey),
    create: async ({ data }) => {
      L.push(data);
      return data;
    },
  },
};
const send = async (req, amt) => {
  const fee = feeFor(amt);
  await transferInTx(tx, {
    fromId: "a",
    toId: "b",
    amount: amt,
    memo: "x",
    key: "p2p:a:" + req,
    week: 1,
  });
  await transferInTx(tx, {
    fromId: "a",
    toId: "w",
    amount: fee,
    memo: "fee",
    key: "fee:a:" + req,
    week: 1,
  });
};
await send("r1", 1_000_000n);
console.log(
  "after sending N10,000: a",
  A.a.balance,
  "b",
  A.b.balance,
  "| fee row",
  L[1].amount,
  "(2% of 1,000,000 =",
  feeFor(1_000_000n) + ")",
);
await send("r1", 1_000_000n);
console.log(
  "replay same requestId -> a",
  A.a.balance,
  "b",
  A.b.balance,
  "ledger rows",
  L.length,
);
const snap = [A.a.balance, A.b.balance, L.length];
try {
  await send("r2", 9_000_000n);
} catch (e) {
  console.log(
    "too big:",
    e instanceof InsufficientFunds ? "InsufficientFunds" : e.message,
  );
}
console.log(
  "conservation (a+b+ledger fee):",
  A.a.balance + A.b.balance + L[1].amount === 10_000_000n,
  "| rows after failed 9M send:",
  L.length,
  "(first leg was written, the DB transaction rolls it back; see note)",
);
if (P2P.maxNaira !== 5_000_000 || P2P.cooldownMs !== 60_000 || "dailyKobo" in P2P) throw new Error("P2P rules are incorrect");
if (transferCooldownRemaining(null, 100_000) !== 0) throw new Error("A first transfer must not be delayed");
if (transferCooldownRemaining(new Date(100_000), 159_999) !== 1) throw new Error("Cooldown must last one minute");
if (transferCooldownRemaining(new Date(100_000), 160_000) !== 0) throw new Error("Cooldown must expire after one minute");
if (feeFor(10_000n) !== 200n) throw new Error("Fee changed unexpectedly");
console.log("per-transfer cap, cooldown expiry, fee and text sanitization:", P2P.maxNaira, P2P.cooldownMs, JSON.stringify(cleanText("hi\u0000 there\n" + "x".repeat(600), 20)));
