// tests/fight.test.mjs: the lecturer brawl (lib/fightSim.js) and what it costs you (lib/fight.js).
import assert from "node:assert/strict";
import { createFight, lecturerStats, playerMaxHp, TIME_LIMIT } from "../lib/fightSim.js";
import { resolveFight, cleanReport, DSA_CATCH_PERCENT, FIGHT_ENERGY, MIN_FIGHT_MS } from "../lib/fight.js";

const play = (opts, policy, secs = 70) => { const s = createFight(opts); for (let t = 0; t < secs && !s.over; t += 1 / 60) s.update(1 / 60, policy?.(s) ?? {}); return s; };

// ---- the brawl ----
const wins = (d, n = 300) => { let w = 0; for (let i = 0; i < n; i++) if (play({ difficulty: d, health: 80, auto: true }).winner === "p") w++; return w / n; };
for (const d of [0.8, 1, 1.45]) assert.ok(wins(d) >= 0.97, `auto-fight should beat a lecturer of difficulty ${d}`);
assert.equal(play({ difficulty: 1, health: 80, auto: false }).winner, "l", "standing still loses");
assert.ok(play({ difficulty: 1, health: 80, auto: false }).time <= TIME_LIMIT + 0.1, "a fight never runs past the time limit");
const mash = () => { let w = 0; for (let i = 0; i < 200; i++) if (play({ difficulty: 1, health: 80, auto: false }, () => (Math.random() < 0.07 ? { punch: true } : {})).winner === "p") w++; return w / 200; };
assert.ok(mash() > 0.9, "tapping punch beats an ordinary lecturer");
assert.ok(lecturerStats(1.45).maxHp > lecturerStats(0.8).maxHp, "a harder lecturer has more health");
assert.ok(playerMaxHp(100) > playerMaxHp(10), "a healthier player has more health");

// a block takes most of the damage, a dodge takes none
{ const s = createFight({ difficulty: 1, health: 80, auto: false, rng: () => 0.5 }); let blocked = 0, dodged = 0, hit = 0;
  for (let t = 0; t < 40 && !s.over; t += 1 / 60) for (const e of s.update(1 / 60, { block: true })) if (e.type === "strike" && e.by === "l") (e.result === "block" ? blocked++ : hit++);
  assert.ok(blocked > 0 && hit === 0, "holding block blocks every swing"); void dodged; }

// the report is what the server hears
{ const s = play({ difficulty: 1, health: 80, auto: true }), r = s.report(); assert.equal(r.won, true); assert.ok(r.ms > MIN_FIGHT_MS && r.landed >= 5 && r.auto === 100); }

// ---- the consequences ----
const c = { energy: 80, health: 90, happiness: 60, popularity: 30, suspicion: 10 }, good = { won: true, ms: 8000, landed: 12, taken: 3 };
assert.equal(cleanReport({ won: "yes" }), null); assert.equal(cleanReport(null), null);
assert.deepEqual(cleanReport({ won: true, ms: 1e9, landed: -4, taken: 3.4 }), { won: true, ms: 600000, landed: 0, taken: 3 });
assert.ok(resolveFight({ ...c, energy: FIGHT_ENERGY - 1 }, good, () => 1).error, "too tired");
assert.ok(resolveFight(c, { ...good, ms: 500 }, () => 1).error, "a win in half a second is not believable");
assert.ok(resolveFight(c, { ...good, landed: 1 }, () => 1).error, "a win without landing hits is not believable");
{ const r = resolveFight(c, { won: false, ms: 9000, landed: 2, taken: 12 }, () => 1); assert.equal(r.won, false); assert.ok(r.stats.health < c.health && r.stats.energy === c.energy - FIGHT_ENERGY); }
{ const r = resolveFight(c, good, () => DSA_CATCH_PERCENT); assert.ok(r.won && r.caught, "a roll at the line is caught"); assert.ok(r.stats.suspicion <= c.suspicion && r.stats.health < c.health, "arrest stats"); }
{ const r = resolveFight(c, good, () => DSA_CATCH_PERCENT + 1); assert.ok(r.won && !r.caught, "a roll above the line escapes"); assert.ok(r.stats.popularity > c.popularity && r.stats.suspicion > c.suspicion); }
assert.equal(DSA_CATCH_PERCENT, 70);
{ let n = 0, k = 20000; for (let i = 0; i < k; i++) if (resolveFight(c, good, (a, b) => a + Math.floor(Math.random() * (b - a + 1))).caught) n++; const p = n / k; assert.ok(p > 0.68 && p < 0.72, `caught about 70% of the time (got ${p})`); }
console.log("fight tests passed");
