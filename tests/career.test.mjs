// tests/career.test.mjs
import { getCareer, jobAction, bizAction } from "../lib/careerService.js";
const week = 8,
  M = (n) => BigInt(n) * 100n,
  A = {
    p: { id: "p", kind: "PLAYER", balance: M(5_000_000) },
    W: { id: "W", kind: "SYSTEM", balance: 0n },
    B: { id: "B", kind: "SYSTEM", balance: 0n },
  };
const C = {
  id: "c1",
  userId: "u1",
  gender: "M",
  hostel: "Awo",
  expelled: false,
  suspendedUntilWeek: 0,
  jailedUntil: null,
  graduated: false,
  lastTickWeek: week,
  level: 100,
  personalities: [],
  energy: 100,
  happiness: 50,
  popularity: 10,
  jobKey: null,
  jobXp: 0,
  account: A.p,
  faculty: { name: "Law", difficulty: 1 },
};
const L = [],
  AL = [],
  BZ = [],
  JS = []; // job shifts (the full shift rules are tested against a real database in tests/pg/jobs.pg.mjs)
let bid = 1n;
const sys = { WORLD: A.W, BUSINESS: A.B };
const tx = {
  $queryRaw: async () => [],
  gameClock: {
    findUnique: async () => ({
      startedAt: new Date(Date.now() - 8 * 3600e3), // 08:00 on day 1 of the game clock: the morning shift window is open
    }),
  },
  character: {
    findUnique: async () => ({ ...C, account: A.p }),
    update: async ({ data }) => Object.assign(C, data),
  },
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
      if (
        AL.find(
          (a) =>
            a.characterId == data.characterId && a.requestId == data.requestId,
        )
      ) {
        const e = new Error("dup");
        e.code = "P2002";
        throw e;
      }
      AL.push(data);
    },
    count: async ({ where }) =>
      AL.filter((a) => a.action == where.action && a.gameWeek == where.gameWeek)
        .length,
  },
  jobShift: {
    findFirst: async ({ where = {} } = {}) => JS.find((x) => (!where.status || x.status === where.status) && (where.gameDay == null || x.gameDay === where.gameDay)) ?? null,
    count: async () => JS.length,
    create: async ({ data }) => { JS.push({ id: BigInt(JS.length + 1), status: "ACTIVE", ...data }); return data; },
    updateMany: async ({ where, data }) => { const x = JS.find((q) => q.id === where.id && q.status === where.status); if (x) Object.assign(x, data); return { count: x ? 1 : 0 }; },
  },
  hustleRun: { findFirst: async () => null },
  business: {
    count: async () => BZ.filter((b) => b.status == "ACTIVE").length,
    create: async ({ data }) => {
      BZ.push({
        id: bid++,
        level: 1,
        employees: 0,
        reputation: 50,
        status: "ACTIVE",
        ...data,
      });
    },
    findFirst: async ({ where }) =>
      BZ.find((b) => b.id == where.id && b.status == where.status) ?? null,
    findMany: async () => BZ.filter((b) => b.status == "ACTIVE"),
    update: async ({ where, data }) =>
      Object.assign(
        BZ.find((b) => b.id == where.id),
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
      r?.note ??
        (r?.duplicate
          ? "(duplicate ignored)"
          : r?.paidKobo
            ? `paid N${BigInt(r.paidKobo) / 100n}`
            : ""),
    );
  } catch (e) {
    console.log("DENY", label, "->", e.status ?? "ERR", e.message);
  }
};
const poolL = () =>
    L.filter((e) => e.creditAccountId == "B").reduce(
      (t, e) => t + e.amount,
      0n,
    ) -
    L.filter((e) => e.debitAccountId == "B").reduce((t, e) => t + e.amount, 0n),
  openCap = () =>
    BZ.filter((b) => b.status == "ACTIVE").reduce((t, b) => t + b.capital, 0n);
const cash = () => "N" + (A.p.balance / 100n).toLocaleString(),
  pool = () => "N" + (A.B.balance / 100n).toLocaleString();
// ----- jobs
await t("pick Developer (Law student, 100L)", () =>
  jobAction(db, "u1", { action: "pick", job: "developer", requestId: rq() }),
);
await t("pick Vendor", () =>
  jobAction(db, "u1", { action: "pick", job: "vendor", requestId: rq() }),
);
C.energy = 100;
await t("clock in: night shift at 08:00 (window opens 18:00)", () => jobAction(db, "u1", { action: "start", shift: "night", requestId: rq() }));
const same = rq();
await t("clock in: morning shift", () => jobAction(db, "u1", { action: "start", shift: "morning", requestId: same }));
await t("replay the same clock-in request", () => jobAction(db, "u1", { action: "start", shift: "morning", requestId: same }));
console.log("     one shift row:", JS.length === 1, "| energy taken once:", C.energy === 85);
await t("a second shift while on shift", () => jobAction(db, "u1", { action: "start", shift: "morning", requestId: rq() }));
await t("claim before the shift ends", () => jobAction(db, "u1", { action: "claim", requestId: rq() }));
JS[0].endsAt = new Date(Date.now() - 1000);
await t("claim after it ends", () => jobAction(db, "u1", { action: "claim", requestId: rq() }));
await t("claim again", () => jobAction(db, "u1", { action: "claim", requestId: rq() }));
console.log("     job xp", C.jobXp, "| paid once:", L.filter((e) => /shift/.test(e.memo)).length === 1);
await t("a second shift the same in-game day", () => jobAction(db, "u1", { action: "start", shift: "morning", requestId: rq() }));
C.energy = 100;
// ----- businesses
await t("start business at 100L", () =>
  bizAction(db, "u1", {
    action: "start",
    type: "FOOD",
    name: "Mama Put Express",
    requestId: rq(),
  }),
);
console.log(
  "     cash",
  cash(),
  "| business pool",
  pool(),
  "| capital",
  BZ[0].capital / 100n,
);
await t("second business at 100L (limit 1)", () =>
  bizAction(db, "u1", {
    action: "start",
    type: "POS",
    name: "Quick POS",
    requestId: rq(),
  }),
);
await t("bad name", () =>
  bizAction(db, "u1", {
    action: "start",
    type: "POS",
    name: "x",
    requestId: rq(),
  }),
);
await t("withdraw above reserve (N200,000)", () =>
  bizAction(db, "u1", {
    action: "withdraw",
    id: "1",
    amountNaira: 200000,
    requestId: rq(),
  }),
);
await t("withdraw into the reserve (N100,000 more)", () =>
  bizAction(db, "u1", {
    action: "withdraw",
    id: "1",
    amountNaira: 100000,
    requestId: rq(),
  }),
);
await t("upgrade with too little capital", () =>
  bizAction(db, "u1", { action: "upgrade", id: "1", requestId: rq() }),
);
await t("add capital N600,000", () =>
  bizAction(db, "u1", {
    action: "capital",
    id: "1",
    amountNaira: 600000,
    requestId: rq(),
  }),
);
await t("upgrade (N480,000 + reserve ok)", () =>
  bizAction(db, "u1", { action: "upgrade", id: "1", requestId: rq() }),
);
console.log(
  "     MID-WAY ledger pool N" + poolL() / 100n,
  "== capital N" + openCap() / 100n,
  ":",
  poolL() === openCap(),
);
console.log(
  "     level",
  BZ[0].level,
  "capital N" + BZ[0].capital / 100n,
  "| pool",
  pool(),
);
for (let i = 0; i < 9; i++)
  await bizAction(db, "u1", { action: "hire", id: "1", requestId: rq() }).catch(
    () => {},
  );
console.log("     employees after 9 hire attempts (cap 8):", BZ[0].employees);
await t("other player's business id", () =>
  bizAction(db, "u1", { action: "hire", id: "999", requestId: rq() }),
);
const bc = BZ[0].capital;
await t("close business", () =>
  bizAction(db, "u1", { action: "close", id: "1", requestId: rq() }),
);
console.log(
  "     status",
  BZ[0].status,
  "| capital returned N" + bc / 100n,
  "| pool now",
  pool(),
);
const cr = await getCareer(db, "u1");
console.log(
  "career view: job",
  cr.job?.title,
  "lvl",
  cr.job?.level,
  "| shifts this week",
  cr.job?.shiftsThisWeek,
  "| jobs locked for Law:",
  cr.jobs
    .filter((j) => j.locked)
    .map((j) => j.key)
    .join(","),
);
console.log(
  "FINAL ledger-derived pool N" + poolL() / 100n,
  "== open capital N" + openCap() / 100n,
  ":",
  poolL() === openCap(),
);
