// tests/tick.test.mjs
import { catchUp } from "../lib/tick.js";
import { priceKobo, valueOf } from "../lib/market.js";
const HOLD = [];
function run(name, char, results, daysAgo, PEND = [], BIZ = []) {
  const L = [],
    notes = [],
    A = {
      W: { id: "W", kind: "SYSTEM", balance: 0n },
      L: { id: "L", kind: "SYSTEM", balance: 0n },
      P: { id: "P", kind: "PLAYER", balance: 0n },
      B: { id: "B", kind: "SYSTEM", balance: 0n },
    },
    sys = { WORLD: A.W, LANDLORDS: A.L, BUSINESS: A.B };
  const tx = {
    $queryRaw: async () => [],
    character: {
      findUnique: async () => ({ ...char, account: A.P }),
      update: async ({ data }) => Object.assign(char, data),
    },
    account: {
      findUnique: async ({ where }) =>
        where.systemName ? sys[where.systemName] : A[where.id],
      update: async ({ where, data }) => {
        const a = A[where.id],
          d = data.balance;
        if (d.decrement) a.balance -= d.decrement;
        if (d.increment) a.balance += d.increment;
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
    examResult: {
      createMany: async ({ data }) => {
        for (const d of data)
          if (!results.find((r) => r.gameWeek == d.gameWeek)) results.push(d);
      },
      findMany: async () => results,
    },
    notification: { create: async ({ data }) => notes.push(data.body) },
    courseProgress: { findFirst: async () => null, update: async () => {} },
    holding: {
      findMany: async () => HOLD,
      update: async ({ where, data }) =>
        Object.assign(
          HOLD.find((h) => h.id == where.id),
          data,
        ),
    },
    business: {
      findMany: async () => BIZ.filter((b) => b.status === "ACTIVE"),
      update: async ({ where, data }) =>
        Object.assign(
          BIZ.find((b) => b.id == where.id),
          data,
        ),
    },
    pregnancy: {
      findMany: async () => PEND.filter((p) => p.status === "PENDING"),
      update: async ({ where, data }) =>
        Object.assign(
          PEND.find((p) => p.id == where.id),
          data,
        ),
    },
  };
  const CT = []; // surprise tests waiting at the faculty (see lib/facultyService.js)
  tx.classTest = {
    findMany: async ({ where }) => CT.filter((t) => t.status === where.status && t.gameWeek < where.gameWeek.lt),
    findFirst: async ({ where }) => CT.find((t) => t.gameWeek === where.gameWeek) ?? null,
    create: async ({ data }) => { CT.push({ id: CT.length + 1, ...data }); return data; },
    update: async ({ where, data }) => Object.assign(CT.find((t) => t.id === where.id), data),
  };
  const db = {
    gameClock: {
      findUnique: async () => ({
        startedAt: new Date(Date.now() - daysAgo * 7 * 864e5), // one "day" of this test is one game week now that the clock is 1:1 with real time
        campusEpoch: null,
        energyRefilledAt: null,
      }),
    },
    character: tx.character, // catchUp's fast path reads the character outside the transaction
    $transaction: async (f) => f(tx),
  };
  tx.gameClock = db.gameClock;
  const cap0 = BIZ.map((b) => b.capital);
  return catchUp(db, "c1").then((r) => {
    BIZ.forEach((b, i) => {
      const inn = L.filter((e) => e.creditAccountId === "B").reduce(
          (t, e) => t + e.amount,
          0n,
        ),
        out = L.filter((e) => e.debitAccountId === "B").reduce(
          (t, e) => t + e.amount,
          0n,
        );
      console.log(
        `  business "${b.name}": status ${b.status}, lastWeek ${b.lastWeek}, capital N${cap0[i] / 100n} -> N${b.capital / 100n}; ledger says profit N${inn / 100n} loss N${out / 100n}; reconciles: ${b.capital - cap0[i] === inn - out}`,
      );
    });
    console.log(
      `\n${name}\n  week ${r.week}, level ${char.level}, sessionStart ${char.sessionStartWeek}, failed ${char.failedSessions}, graduated ${!!char.graduated}${char.classification ? " (" + char.classification + ")" : ""}, expelled ${!!char.expelled}\n  cash N${(A.P.balance / 100n).toLocaleString()}, ledger rows ${L.length}, dependents ${char.dependents}, suspendedUntil ${char.suspendedUntilWeek}, popularity ${char.popularity}, childcare charges ${L.filter((e) => e.memo === "Childcare").length} totalling N${L.filter((e) => e.memo === "Childcare").reduce((t, e) => t + e.amount, 0n) / 100n}, pregnancy ${PEND[0]?.status ?? "none"}\n  notes: ${notes.join(" | ")}\n  surprise tests announced: ${notes.filter((n) => /surprise test/.test(n)).length}`,
    );
    char.energy = 40;
    char.suspicion = 20;
    const rows = L.length;
    return catchUp(db, "c1").then(() =>
      console.log(
        `  SECOND request same week: energy ${char.energy} (must stay 40), suspicion ${char.suspicion} (must stay 20), new ledger rows ${L.length - rows}`,
      ),
    );
  });
}
const base = () => ({
  faculty: { name: "Science", difficulty: 1.1 },
  academics: 50,
  luck: 50,
  gender: "F",
  dependents: 0,
  suspendedUntilWeek: 0,
  popularity: 30,
  id: "c1",
  hostel: "Awo",
  class: "MAPO",
  joinedWeek: 1,
  sessionStartWeek: 1,
  failedSessions: 0,
  level: 100,
  lastTickWeek: 0,
  lastParentCallWeek: 99,
  missedCallStreak: 0,
  happiness: 60,
  suspicion: 0,
});
await run(
  "A: good student, 24 days in",
  base(),
  [6, 12, 18, 24].map((w) => ({ gameWeek: w, gradePoint: 3 })),
  24,
);
await run("B: never sits an exam", base(), [], 24);
await run(
  "C: 500L finalist with straight 5s",
  { ...base(), level: 500 },
  [6, 12].map((w) => ({ gameWeek: w, gradePoint: 5 })),
  12,
);

await run(
  "D: dependent + undecided pregnancy (decideBy 3), 6 weeks",
  { ...base(), dependents: 1 },
  [],
  5,
  [{ id: 1, status: "PENDING", decideBy: 3 }],
);

const biz = (o = {}) => ({
  id: 1n,
  name: "Mama Put",
  type: "FOOD",
  level: 1,
  employees: 2,
  reputation: 50,
  capital: 30_000_000n,
  status: "ACTIVE",
  lastWeek: 0,
  ...o,
});
await run(
  "E: student with a Food business, 6 weeks",
  base(),
  [],
  5,
  [],
  [biz()],
);
await run(
  "F: GRADUATE with a business: no allowance, business keeps trading",
  { ...base(), graduated: true, level: 500 },
  [],
  5,
  [],
  [biz({ id: 2n, name: "Grad Foods" })],
);
await run(
  "G: business with almost no capital and a bad run",
  base(),
  [],
  5,
  [],
  [
    biz({
      id: 3n,
      name: "Shaky Ltd",
      type: "EVENTS",
      employees: 8,
      capital: 100_000n,
    }),
  ],
);

HOLD.push({
  id: 1n,
  product: "INDEX",
  unitsMicro: 5_000_000_000n,
  valueKobo: 0n,
});
await run(
  "H: investments are re-valued at the current week's price",
  base(),
  [],
  5,
);
console.log(
  "  holding value now N" + HOLD[0].valueKobo / 100n,
  "| expected N" + valueOf(5_000_000_000n, priceKobo("INDEX", 6)) / 100n,
  "(5,000 units at the week-6 price) | match:",
  HOLD[0].valueKobo === valueOf(5_000_000_000n, priceKobo("INDEX", 6)),
);

await run(
  "I: 24 weeks of lectures, surprise tests may be announced",
  { ...base(), lastParentCallWeek: 99 },
  [1, 2, 3, 4].map((i) => ({ gameWeek: i * 6, gradePoint: 3 })),
  23,
);
