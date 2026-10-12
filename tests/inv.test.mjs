// tests/inv.test.mjs
import { getInvestments, invest } from "../lib/investService.js";
import { priceKobo, valueOf, investCap } from "../lib/market.js";
let week = 8;
const M = (n) => BigInt(n) * 100n,
  A = {
    p: { id: "p", kind: "PLAYER", balance: M(10_000_000) },
    K: { id: "K", kind: "SYSTEM", balance: 0n },
    W: { id: "W", kind: "SYSTEM", balance: 0n },
  },
  sys = { MARKET: A.K, WORLD: A.W };
const C = {
  id: "c1",
  userId: "u1",
  gender: "M",
  hostel: "Awo",
  expelled: false,
  graduated: false,
  suspendedUntilWeek: 0,
  jailedUntil: null,
  level: 100,
  lastTickWeek: week,
  personalities: [],
  account: A.p,
  faculty: { name: "Law" },
};
const L = [],
  AL = [],
  H = [];
let hid = 1n;
const tx = {
  $queryRaw: async () => [],
  gameClock: {
    findUnique: async () => ({
      startedAt: new Date(Date.now() - (week - 1) * 864e5 - 1000),
    }),
  },
  character: { findUnique: async () => ({ ...C, account: A.p }) },
  account: {
    findUnique: async ({ where }) => ({
      ...(where.systemName ? sys[where.systemName] : A[where.id]),
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
  actionLog: {
    create: async ({ data }) => {
      if (AL.find((a) => a.requestId == data.requestId)) {
        const e = new Error("dup");
        e.code = "P2002";
        throw e;
      }
      AL.push(data);
    },
  },
  holding: {
    findMany: async () => H,
    findFirst: async ({ where }) =>
      H.find((h) => h.product == where.product) ?? null,
    create: async ({ data }) => {
      H.push({ id: hid++, ...data });
    },
    update: async ({ where, data }) =>
      Object.assign(
        H.find((h) => h.id == where.id),
        data,
      ),
  },
};
const db = { ...tx, $transaction: async (f) => f(tx) };
let n = 0;
const rq = () => "req-" + String(++n).padStart(8, "0");
const t = async (label, fn) => {
  try {
    const r = await fn();
    console.log(
      "OK  ",
      label,
      r?.note ?? (r?.duplicate ? "(duplicate ignored)" : ""),
    );
  } catch (e) {
    console.log("DENY", label, "->", e.status ?? "ERR", e.message);
  }
};
const cash = () => A.p.balance / 100n,
  pool = () =>
    L.filter((e) => e.creditAccountId == "K").reduce(
      (t, e) => t + e.amount,
      0n,
    ) -
    L.filter((e) => e.debitAccountId == "K").reduce((t, e) => t + e.amount, 0n);
const g = await getInvestments(db, "u1");
console.log(
  "market:",
  g.news.regime,
  "-",
  g.news.headline,
  "| products",
  g.products.length,
  "| cap N" + BigInt(g.capKobo) / 100n,
  "| history points",
  g.products[0].history.length,
  "| fee",
  g.feePercent + "% early-sale penalty",
  g.earlyPenaltyPercent + "%",
);
let c0 = cash();
await t("buy N100,000 of Index Fund", () =>
  invest(db, "u1", {
    action: "buy",
    product: "INDEX",
    amountNaira: 100000,
    requestId: rq(),
  }),
);
console.log(
  "     cash spent N" + (c0 - cash()),
  "(100,000 + 1% fee 1,000) | market ledger received N" + pool() / 100n,
  "| fee row to world N" +
    L.find((e) => e.memo == "Brokerage fee").amount / 100n,
  "| holding value N" + H[0].valueKobo / 100n,
);
const same = rq();
c0 = cash();
await invest(db, "u1", {
  action: "buy",
  product: "BILLS",
  amountNaira: 50000,
  requestId: same,
});
const a1 = cash();
await t("replay that buy", () =>
  invest(db, "u1", {
    action: "buy",
    product: "BILLS",
    amountNaira: 50000,
    requestId: same,
  }),
);
console.log("     cash unchanged by replay:", cash() === a1);
await t("buy N500 (below minimum)", () =>
  invest(db, "u1", {
    action: "buy",
    product: "INDEX",
    amountNaira: 500,
    requestId: rq(),
  }),
);
await t("buy over the 100L limit (N5M cap)", () =>
  invest(db, "u1", {
    action: "buy",
    product: "PLOTS",
    amountNaira: 5000000,
    requestId: rq(),
  }),
);
await t("sell something not held", () =>
  invest(db, "u1", {
    action: "sell",
    product: "MEME",
    percent: 50,
    requestId: rq(),
  }),
);
await t("sell 0 percent", () =>
  invest(db, "u1", {
    action: "sell",
    product: "INDEX",
    percent: 0,
    requestId: rq(),
  }),
);
c0 = cash();
await t("sell 100% of Index (no lock) same week", () =>
  invest(db, "u1", {
    action: "sell",
    product: "INDEX",
    percent: 100,
    requestId: rq(),
  }),
);
console.log(
  "     round trip cost N" + (100000n - (cash() - c0)),
  "~ 2% fees (N1,000 buy fee + ~N990 sell fee) | units left",
  H.find((h) => h.product == "INDEX").unitsMicro,
  "| cost basis left",
  H.find((h) => h.product == "INDEX").costKobo,
);
c0 = cash();
await invest(db, "u1", {
  action: "buy",
  product: "COOP",
  amountNaira: 200000,
  requestId: rq(),
});
const afterBuy = cash();
await t("sell 50% of Cooperative inside its 3-week lock", () =>
  invest(db, "u1", {
    action: "sell",
    product: "COOP",
    percent: 50,
    requestId: rq(),
  }),
);
const got = cash() - afterBuy;
console.log(
  "     received N" + got,
  "for half of N200,000 (expected about N100,000 x (1 - 5% - 1%) = N94,000)",
);
week = 12;
C.lastTickWeek = week;
const c1 = cash();
await t("sell the rest of Cooperative at week 12 (lock over)", () =>
  invest(db, "u1", {
    action: "sell",
    product: "COOP",
    percent: 100,
    requestId: rq(),
  }),
);
console.log(
  "     received N" + (cash() - c1),
  "no penalty; value had grown with the week-12 price",
);
A.p.balance = M(500);
await t("buy N10,000 with only N500 in cash", () =>
  invest(db, "u1", {
    action: "buy",
    product: "INDEX",
    amountNaira: 10000,
    requestId: rq(),
  }),
);
console.log(
  "holdings rows with negative or odd values:",
  H.filter((h) => h.unitsMicro < 0n || h.costKobo < 0n).length,
  "| market pool (money in minus out) N" + pool() / 100n,
);
