// tests/rl.test.mjs
import { hit, allowed, windowOf } from "../lib/ratelimit.js";
const M = new Map();
const db = {
  rateLimit: { deleteMany: async () => {} },
  $queryRaw: async (_s, key, w) => {
    const k = key + "|" + w.getTime();
    M.set(k, (M.get(k) ?? 0) + 1);
    return [{ count: M.get(k) }];
  },
};
const t = Date.UTC(2026, 9, 4, 12, 0, 10),
  MIN = 60_000;
const res = [];
for (let i = 1; i <= 7; i++)
  res.push(await allowed(db, "signup:1.2.3.4", 5, MIN, t + i * 100));
console.log(
  "7 rapid signups, limit 5:",
  res.map((x) => (x ? "ok" : "BLOCKED")).join(" "),
);
console.log(
  "other IP unaffected:",
  await allowed(db, "signup:9.9.9.9", 5, MIN, t),
);
console.log(
  "next minute resets:",
  await allowed(db, "signup:1.2.3.4", 5, MIN, t + MIN),
  "| window start",
  windowOf(t, MIN).toISOString(),
);
const burst = await Promise.all(
  Array.from({ length: 10 }, () => hit(db, "login-email:a@b.c", 900_000, t)),
);
console.log(
  "10 concurrent hits get distinct counts:",
  new Set(burst).size === 10,
  "(max",
  Math.max(...burst) + ")",
);
