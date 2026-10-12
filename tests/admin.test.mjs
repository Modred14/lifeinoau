// tests/admin.test.mjs
import {
  requireAdmin,
  adjustMoney,
  resolveReport,
  AdminError,
} from "../lib/admin.js";
const A = {
    p: { id: "p", kind: "PLAYER", balance: 50_000_00n },
    w: { id: "w", kind: "SYSTEM", balance: 0n },
  },
  L = [],
  AUD = [];
const users = {
    u1: { id: "u1", role: "PLAYER" },
    ad: { id: "ad", role: "ADMIN" },
  },
  chars = { bola: { id: "c1", name: "Bola", account: A.p } };
const reports = [{ id: 7n, targetId: "c1", reporterId: "c2", status: "OPEN" }],
  target = { suspendedUntilWeek: 0 };
const tx = {
  $queryRaw: async () => [],
  user: { findUnique: async ({ where }) => users[where.id] ?? null },
  character: {
    findFirst: async ({ where }) =>
      chars[where.name.equals.toLowerCase()] ?? null,
    update: async ({ data }) => Object.assign(target, data),
  },
  account: {
    findUnique: async ({ where }) => ({
      ...(where.systemName ? A.w : A[where.id]),
    }),
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
  auditLog: { create: async ({ data }) => AUD.push(data) },
  report: {
    findUnique: async () => reports[0],
    update: async ({ data }) => Object.assign(reports[0], data),
  },
};
const db = {
  ...tx,
  gameClock: {
    findUnique: async () => ({ startedAt: new Date(Date.now() - 9 * 864e5) }),
  },
  $transaction: async (f) => f(tx),
};
const t = async (label, fn) => {
  try {
    const r = await fn();
    console.log("OK  ", label, r ? JSON.stringify(r) : "");
  } catch (e) {
    console.log(
      "DENY",
      label,
      "->",
      e instanceof AdminError ? `${e.status} ${e.message}` : e.message,
    );
  }
};
await t("player tries admin access", () => requireAdmin(db, "u1"));
await t("unknown user tries admin access", () => requireAdmin(db, "zz"));
await t("admin access", () => requireAdmin(db, "ad").then((u) => u.role));
const adj = (o) =>
  adjustMoney(db, "ad", {
    name: "Bola",
    direction: "credit",
    amountNaira: 5000,
    reason: "Refund for bug #12",
    requestId: "req-00000001",
    ...o,
  });
await t("credit N5,000 with reason", adj);
console.log(
  "     player now N" + A.p.balance / 100n,
  "| ledger rows",
  L.length,
  "| audit:",
  AUD[0]?.action,
);
await t("replay same requestId", adj);
console.log(
  "     player still N" + A.p.balance / 100n,
  "| ledger rows",
  L.length,
);
await t("reason too short", () =>
  adj({ reason: "ok", requestId: "req-00000002" }),
);
await t("amount N5,000,000 (over cap)", () =>
  adj({ amountNaira: 5_000_000, requestId: "req-00000003" }),
);
await t("debit more than player has", () =>
  adj({ direction: "debit", amountNaira: 900_000, requestId: "req-00000004" }),
);
await t("resolve report without note", () =>
  resolveReport(db, "ad", { id: "7", action: "suspend", note: "" }),
);
await t("suspend via report", () =>
  resolveReport(db, "ad", {
    id: "7",
    action: "suspend",
    note: "Repeated harassment in chat",
  }),
);
console.log(
  "     suspendedUntilWeek",
  target.suspendedUntilWeek,
  "| report status",
  reports[0].status,
);
await t("resolve the same report again", () =>
  resolveReport(db, "ad", {
    id: "7",
    action: "dismiss",
    note: "second attempt",
  }),
);
console.log("audit trail:", AUD.map((a) => a.action).join(", "));
