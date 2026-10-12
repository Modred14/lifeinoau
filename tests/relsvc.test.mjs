// tests/relsvc.test.mjs
import {
  getRelationship,
  relate,
  decidePregnancy,
} from "../lib/relationshipService.js";
const week = 8,
  A = {
    p: { id: "p", kind: "PLAYER", balance: 100_000_000n },
    V: { id: "V", kind: "SYSTEM", balance: 0n },
    K: { id: "K", kind: "SYSTEM", balance: 0n },
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
  personalities: [],
  energy: 90,
  happiness: 50,
  popularity: 20,
  luck: 50,
  dependents: 0,
  account: A.p,
  faculty: { difficulty: 1 },
};
const R = [],
  P = [],
  L = [],
  AL = [],
  NT = [];
let rid = 1n,
  pid = 1n;
const match = (o, w) =>
  Object.entries(w).every(([k, v]) =>
    v && typeof v == "object" && "gte" in v ? o[k] >= v.gte : o[k] === v,
  );
const sort = (a, ob) =>
  ob?.endedWeek ? [...a].sort((x, y) => y.endedWeek - x.endedWeek) : a;
const tx = {
  $queryRaw: async () => [],
  gameClock: {
    findUnique: async () => ({
      startedAt: new Date(Date.now() - (week - 1) * 864e5 - 1000),
    }),
  },
  character: {
    findUnique: async ({ where }) => ({ ...C, account: A.p }),
    update: async ({ data }) => Object.assign(C, data),
  },
  account: {
    findUnique: async ({ where }) =>
      where.systemName
        ? { ...(where.systemName == "VENUES" ? A.V : A.K) }
        : { ...A[where.id] },
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
  relationship: {
    findFirst: async ({ where, orderBy }) =>
      sort(
        R.filter((r) => match(r, where)),
        orderBy,
      )[0] ?? null,
    create: async ({ data }) => {
      const r = {
        id: rid++,
        stage: "STRANGER",
        affection: 0,
        status: "ACTIVE",
        endedWeek: null,
        lastGiftWeek: null,
        lastDateWeek: null,
        ...data,
      };
      R.push(r);
      return r;
    },
    update: async ({ where, data }) =>
      Object.assign(
        R.find((r) => r.id == where.id),
        data,
      ),
    updateMany: async ({ where, data }) =>
      R.filter((r) => r.id == where.id && r.status == where.status).forEach(
        (r) => Object.assign(r, data),
      ),
  },
  pregnancy: {
    findFirst: async ({ where }) => P.find((p) => match(p, where)) ?? null,
    create: async ({ data }) => {
      P.push({ id: pid++, status: "PENDING", ...data });
    },
    update: async ({ where, data }) =>
      Object.assign(
        P.find((p) => p.id == where.id),
        data,
      ),
  },
  notification: { create: async ({ data }) => NT.push(data.body) },
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
      r?.note ?? (r?.duplicate ? "(duplicate ignored)" : (r?.choice ?? "")),
    );
  } catch (e) {
    console.log("DENY", label, "->", e.status ?? "ERR", e.message);
  }
};
const cash = () => "N" + (A.p.balance / 100n).toLocaleString();
const g = await getRelationship(db, "u1");
console.log(
  "candidates for a man:",
  g.candidates.map((c) => c.name + "/" + c.trait).join(", "),
  "| partner:",
  g.current,
);
await t("start with candidate 0", () =>
  relate(db, "u1", { action: "start", slot: 0, requestId: rq() }),
);
await t("start again while seeing someone", () =>
  relate(db, "u1", { action: "start", slot: 1, requestId: rq() }),
);
await t("advance at affection 0", () =>
  relate(db, "u1", { action: "advance", requestId: rq() }),
);
for (let i = 0; i < 3; i++)
  await relate(db, "u1", { action: "chat", requestId: rq() });
console.log("     after 3 chats affection", R[0].affection, "energy", C.energy);
await t("advance to Friend", () =>
  relate(db, "u1", { action: "advance", requestId: rq() }),
);
console.log("     stage", R[0].stage);
const before = A.p.balance;
await t("medium gift", () =>
  relate(db, "u1", { action: "gift", tier: "medium", requestId: rq() }),
);
console.log("     gift cost", (before - A.p.balance) / 100n, "naira");
await t("second gift same week", () =>
  relate(db, "u1", { action: "gift", tier: "small", requestId: rq() }),
);
await t("date while only a friend", () =>
  relate(db, "u1", { action: "date", requestId: rq() }),
);
await t("close while only a friend", () =>
  relate(db, "u1", { action: "close", requestId: rq() }),
);
const same = rq();
await relate(db, "u1", { action: "chat", requestId: same });
const aff = R[0].affection;
await t("replay a chat request", () =>
  relate(db, "u1", { action: "chat", requestId: same }),
);
console.log("     affection unchanged on replay:", R[0].affection === aff);
// pregnancy decisions
P.push({
  id: pid++,
  characterId: "c1",
  relationshipId: 1n,
  startedWeek: 7,
  decideBy: 9,
  status: "PENDING",
});
const g2 = await getRelationship(db, "u1");
console.log(
  "pending pregnancy shown:",
  JSON.stringify(g2.pregnancy),
  "| male player sees partnerIsPregnant:",
  g2.partnerIsPregnant,
);
await t("close while pregnancy pending", () =>
  relate(db, "u1", { action: "close", requestId: rq() }),
);
A.p.balance = 100_000_00n;
await t("end option with only N100,000", () =>
  decidePregnancy(db, "u1", { choice: "end", requestId: rq() }),
);
console.log("     still pending:", P[0].status, "| cash", cash());
A.p.balance = 10_000_000_00n;
const b2 = A.p.balance;
await t("keep", () =>
  decidePregnancy(db, "u1", { choice: "keep", requestId: rq() }),
);
console.log(
  "     paid",
  (b2 - A.p.balance) / 100n,
  "naira | dependents",
  C.dependents,
  "| status",
  P[0].status,
);
await t("decide again", () =>
  decidePregnancy(db, "u1", { choice: "end", requestId: rq() }),
);
await t("breakup", () =>
  relate(db, "u1", { action: "breakup", requestId: rq() }),
);
const b3 = A.p.balance;
await t("reconcile within 4 weeks", () =>
  relate(db, "u1", { action: "reconcile", requestId: rq() }),
);
console.log(
  "     paid",
  (b3 - A.p.balance) / 100n,
  "| stage",
  R[0].stage,
  "affection",
  R[0].affection,
  "status",
  R[0].status,
);
await t("reconcile while together", () =>
  relate(db, "u1", { action: "reconcile", requestId: rq() }),
);
console.log("notifications:", NT.length);
