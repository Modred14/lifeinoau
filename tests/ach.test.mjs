// tests/ach.test.mjs
import { evaluate, ACHIEVEMENTS, titleOf } from "../lib/achievements.js";
import { syncAchievements } from "../lib/achievementService.js";
const M = (n) => BigInt(n) * 100n,
  snap = (o) => ({
    cash: 0n,
    class: "MAPO",
    graduated: false,
    classification: null,
    popularity: 10,
    tickets: 0,
    datedStage: false,
    arrests: 0,
    exams: 0,
    cgpa: 0,
    ...o,
  });
const keys = (o) => evaluate(snap(o)).join(",") || "(none)";
console.log("fresh player:", keys({}));
console.log(
  "N999,999 vs N1,000,000:",
  keys({ cash: M(999_999) }),
  "|",
  keys({ cash: M(1_000_000) }),
);
console.log(
  "LAPO with N5M:",
  keys({ class: "LAPO", cash: M(5_000_000) }),
  "| MAPO with N5M:",
  keys({ cash: M(5_000_000) }),
);
console.log(
  "NEPO graduate, First Class:",
  keys({ class: "NEPO", graduated: true, classification: "First Class" }),
);
console.log(
  "CGPA 4.2 after 3 exams vs 4:",
  keys({ cgpa: 4.2, exams: 3 }),
  "|",
  keys({ cgpa: 4.2, exams: 4 }),
);
console.log(
  "popularity 70 / 90:",
  keys({ popularity: 70 }),
  "|",
  keys({ popularity: 90 }),
);
console.log(
  "5 nights out, dated, arrested:",
  keys({ tickets: 5, datedStage: true, arrests: 1 }),
);
const bc = ACHIEVEMENTS.find((a) => a.key === "campus_big");
console.log("gendered titles:", titleOf(bc, "M"), "/", titleOf(bc, "F"));
console.log(
  "business achievements: none without businesses:",
  !evaluate(snap({ bizEver: 0, techEver: 0, bizActive: 0 })).some((k) =>
    /business|tech_bro/.test(k),
  ),
  "| with 3 active incl. tech:",
  evaluate(snap({ bizEver: 3, techEver: 1, bizActive: 3 }))
    .filter((k) => /business|tech_bro/.test(k))
    .join(","),
);
// sync against a fake db
const have = [],
  notes = [];
const c = {
  id: "c1",
  gender: "F",
  class: "MAPO",
  graduated: false,
  classification: null,
  popularity: 75,
  account: { balance: M(2_000_000) },
};
const db = {
  character: { findUnique: async () => c },
  achievement: {
    findMany: async () => have.map((k) => ({ key: k })),
    create: async ({ data }) => {
      if (have.includes(data.key)) {
        const e = new Error("dup");
        e.code = "P2002";
        throw e;
      }
      have.push(data.key);
    },
  },
  partyTicket: { count: async () => 0 },
  business: { count: async () => 0 },
  relationship: { count: async () => 0 },
  floorZero: { count: async () => 0 },
  examResult: { findMany: async () => [] },
  notification: { create: async ({ data }) => notes.push(data.body) },
};
console.log(
  "\nfirst sync awards:",
  (await syncAchievements(db, "c1", 9)).join(", "),
);
console.log(
  "second sync awards:",
  (await syncAchievements(db, "c1", 10)).join(", ") || "(nothing new)",
  "| notifications:",
  notes.length,
);
c.account.balance = 0n;
await syncAchievements(db, "c1", 11);
console.log(
  "after spending everything, still owned:",
  have.includes("first_million"),
  "(earned once, kept)",
);
console.log(notes);
