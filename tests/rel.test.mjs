// tests/rel.test.mjs
import {
  candidates,
  resolveRelAction,
  canAdvance,
  decayFor,
  NEED,
  PREGNANCY_RISK,
} from "../lib/relationships.js";
import { randomInt } from "node:crypto";
const roll = (a, b) => randomInt(a, b + 1);
const c = {
  energy: 80,
  happiness: 50,
  popularity: 20,
  luck: 50,
  personalities: [],
};
const a = candidates("c1", "M", 5),
  b = candidates("c1", "M", 5);
console.log(
  "candidates for a man (opposite gender), deterministic:",
  a.map((x) => x.name + "/" + x.trait).join(", "),
  "| same on reload:",
  JSON.stringify(a) === JSON.stringify(b),
  "| names unique:",
  new Set(a.map((x) => x.name)).size === 3,
);
console.log(
  "candidates for a woman:",
  candidates("c2", "F", 5)
    .map((x) => x.name)
    .join(", "),
);
const rel = (o) => ({
  stage: "STRANGER",
  affection: 0,
  npcTrait: "Bold",
  lastWeek: 5,
  lastGiftWeek: null,
  lastDateWeek: null,
  ...o,
});
const tryA = (act, o, r, opts = {}) => {
  const x = resolveRelAction(c, rel(o), act, opts, roll, r?.week ?? 5);
  return x.error
    ? "ERR " + x.error
    : `aff ${x.affection} cost N${x.costKobo / 100n}` +
        (x.pregnancy ? " PREGNANCY" : "");
};
console.log("date at friend stage:", tryA("date", { stage: "FRIEND" }));
console.log("close at talking stage:", tryA("close", { stage: "TALKING" }));
console.log("date at talking stage:", tryA("date", { stage: "TALKING" }));
console.log(
  "second gift same week:",
  tryA("gift", { lastGiftWeek: 5 }, 0, { tier: "small" }),
);
console.log(
  "tired:",
  resolveRelAction({ ...c, energy: 3 }, rel(), "chat", {}, roll, 5).error,
);
const avg = (act, trait, n = 20000) => {
  let s = 0;
  for (let i = 0; i < n; i++)
    s +=
      resolveRelAction(
        c,
        rel({ npcTrait: trait, stage: "TALKING", affection: 20 }),
        act,
        { tier: "medium" },
        roll,
        5,
      ).affection - 20;
  return (s / n).toFixed(1);
};
console.log(
  "liked vs neutral: flirt Bold",
  avg("flirt", "Bold"),
  "vs Caring",
  avg("flirt", "Caring"),
  "| gift Fashionable",
  avg("gift", "Fashionable"),
  "vs Bold",
  avg("gift", "Bold"),
);
console.log(
  "decay: no contact 1wk",
  decayFor(5, 6),
  "| 4wks",
  decayFor(5, 9),
  "| same week",
  decayFor(5, 5),
  "| after 4 weeks away affection 50 ->",
  resolveRelAction(
    c,
    rel({ affection: 50, lastWeek: 5 }),
    "chat",
    {},
    () => 6,
    9,
  ).affection,
  "(50-12+6)",
);
console.log(
  "advance gates: FRIEND at 9?",
  canAdvance(rel({ affection: 9 })),
  "at 10?",
  canAdvance(rel({ affection: 10 })),
  "| DATING needs",
  NEED.DATING,
  "from SNEAKY at 69?",
  canAdvance(rel({ stage: "SNEAKY", affection: 69 })),
  "70?",
  canAdvance(rel({ stage: "SNEAKY", affection: 70 })),
);
const rate = (act, n = 100000) => {
  let p = 0;
  for (let i = 0; i < n; i++)
    if (
      resolveRelAction(
        c,
        rel({ stage: "DATING", affection: 80 }),
        act,
        {},
        roll,
        5,
      ).pregnancy
    )
      p++;
  return ((p / n) * 100).toFixed(1) + "%";
};
console.log(
  "pregnancy chance per time: close",
  rate("close"),
  "(design 6%) | safe-close",
  rate("safe-close"),
  "(design 1%)",
);
console.log(
  "chat before dating cannot cause pregnancy:",
  resolveRelAction(c, rel({ stage: "DATING" }), "chat", {}, roll, 5)
    .pregnancy === false,
);
