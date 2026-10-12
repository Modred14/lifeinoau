// tests/party.test.mjs
import { partyFor, resolveNight, VENUES } from "../lib/parties.js";
import { attendParty, GameError } from "../lib/gameService.js";
import { randomInt } from "node:crypto";
const roll = (a, b) => randomInt(a, b + 1);
// 1. deterministic + bounded
const a = partyFor("Quantum", 12),
  b = partyFor("Quantum", 12),
  c = partyFor("Quantum", 13);
console.log(
  "same week twice identical:",
  JSON.stringify(a, (k, v) => (typeof v == "bigint" ? v.toString() : v)) ===
    JSON.stringify(b, (k, v) => (typeof v == "bigint" ? v.toString() : v)),
  "| next week differs:",
  a.theme !== c.theme || a.priceKobo !== c.priceKobo,
);
let bad = 0;
for (let w = 1; w <= 500; w++)
  for (const v of Object.keys(VENUES)) {
    const p = partyFor(v, w),
      n = Number(p.priceKobo / 100n),
      B = VENUES[v];
    if (
      n < B.base * 0.75 ||
      n > B.base * 1.55 ||
      p.capacity < B.cap * 0.79 ||
      p.capacity > B.cap * 1.21 ||
      n % 500
    )
      bad++;
  }
console.log("1500 parties within price/capacity bounds:", bad === 0);
// 2. night outcomes + personalities
const base = {
  energy: 80,
  happiness: 50,
  popularity: 20,
  suspicion: 0,
  health: 80,
};
const dist = {};
for (let i = 0; i < 40000; i++) {
  const r = resolveNight({ ...base, personalities: [] }, roll);
  dist[r.title] = (dist[r.title] ?? 0) + 1;
}
console.log(
  "outcomes:",
  Object.entries(dist)
    .map(([k, v]) => `${k} ${(v / 400).toFixed(0)}%`)
    .join(", "),
);
const avg = (p) => {
  let s = 0;
  for (let i = 0; i < 20000; i++)
    s += resolveNight({ ...base, personalities: p }, roll).stats.popularity;
  return (s / 20000 - 20).toFixed(1);
};
console.log(
  "avg popularity gained -> animal+extrovert",
  avg(["Party Animal", "Extrovert"]),
  "| plain",
  avg([]),
  "| introvert",
  avg(["Introvert"]),
);
console.log(
  "too tired:",
  resolveNight({ ...base, energy: 10, personalities: [] }, roll).error,
  "| introvert needs 25:",
  !!resolveNight({ ...base, energy: 22, personalities: ["Introvert"] }, roll)
    .error,
);
// 3. full purchase against a fake DB
const week = Math.floor(3),
  price = partyFor("Quantum", week).priceKobo,
  cap = 2;
const A = {
  p1: { id: "p1", kind: "PLAYER", balance: price * 3n },
  p2: { id: "p2", kind: "PLAYER", balance: price * 3n },
  p3: { id: "p3", kind: "PLAYER", balance: price * 3n },
  p4: { id: "p4", kind: "PLAYER", balance: 10n },
  V: { id: "V", kind: "SYSTEM", balance: 0n },
};
const chars = { u1: "p1", u2: "p2", u3: "p3", u4: "p4" },
  C = {},
  L = [],
  T = [],
  AL = [],
  night = { n: 0 };
for (const [u, p] of Object.entries(chars))
  C[u] = {
    id: "c" + p,
    userId: u,
    hostel: "Awo",
    expelled: false,
    suspendedUntilWeek: 0,
    jailedUntil: null,
    personalities: [],
    energy: 90,
    happiness: 50,
    popularity: 10,
    suspicion: 0,
    health: 80,
    account: A[p],
    faculty: { difficulty: 1 },
  };
const mk = () => ({
  $queryRaw: async (s, ...v) => {
    if (String(s[0]).includes("PartyNight")) {
      if (night.n >= cap) return [];
      night.n++;
      return [{ attendees: night.n }];
    }
    return [];
  },
  character: {
    findUnique: async ({ where }) => {
      const c =
        C[where.userId] ?? Object.values(C).find((x) => x.id == where.id);
      return c && { ...c, account: c.account };
    },
    update: async ({ where, data }) =>
      Object.assign(
        Object.values(C).find((x) => x.id == where.id),
        data,
      ),
  },
  account: {
    findUnique: async ({ where }) =>
      where.systemName ? { ...A.V } : { ...A[where.id] },
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
  },
  partyTicket: {
    findFirst: async ({ where }) =>
      T.find(
        (t) =>
          t.characterId == where.characterId && t.gameWeek == where.gameWeek,
      ),
    create: async ({ data }) => T.push(data),
  },
  notification: { create: async () => {} },
});
const clock = {
  findUnique: async () => ({
    startedAt: new Date(Date.now() - (week - 1) * 864e5 - 1000),
  }),
};
const tx = { ...mk(), gameClock: clock };
const db = { ...tx, $transaction: async (f) => f(tx) };
// catchUp needs more of the fake; stub it by pre-setting lastTickWeek and a no-hostel bypass: patch character fields it reads
for (const c of Object.values(C)) {
  Object.assign(c, { graduated: false, lastTickWeek: week });
} // catchUp returns early for finished characters
const go = async (u, req) => {
  try {
    const r = await attendParty(db, u, "Quantum", req);
    return r.duplicate ? "duplicate (ignored)" : `in: "${r.title}"`;
  } catch (e) {
    return `${e.status ?? "ERR"} ${e.message}`;
  }
};
console.log("player1:", await go("u1", "req-0000001"));
console.log("player1 retries same request:", await go("u1", "req-0000001"));
console.log("player1 new request, same week:", await go("u1", "req-0000002"));
console.log("player2:", await go("u2", "req-0000003"));
console.log("player3 (venue full at 2):", await go("u3", "req-0000004"));
console.log("tickets sold", T.length, "| venue counter", night.n, "/", cap);
const toV = L.filter((e) => e.creditAccountId == "V").reduce(
  (t, e) => t + e.amount,
  0n,
);
console.log(
  "ledger: venue received",
  toV / 100n,
  "naira from",
  L.filter((e) => e.creditAccountId == "V").length,
  "entries; 2 tickets =",
  (price * 2n) / 100n,
  "naira; covers tickets:",
  toV >= price * 2n,
);
console.log(
  "p1 paid at least ticket price:",
  A.p1.balance <= price * 3n - price,
  "| venue earned >= 2 tickets:",
  A.V.balance >= price * 2n,
);
