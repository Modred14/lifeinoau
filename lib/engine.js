// lib/engine.js
// Pure game rules: no database, no I/O, so they are easy to test. Randomness is injected.
export const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const N = (n) => BigInt(n) * 100n; // naira -> kobo

// Each action: energy cost, stat changes, and an optional money effect.
export const ACTIONS = {
  class:  { energy: 12, stats: (c) => ({ academics: 4, popularity: c.personalities.includes("Introvert") ? 0 : 1 }) },
  study:  { energy: 15, stats: () => ({ academics: 6, happiness: -2 }) },
  rest:   { energy: 0,  stats: (c) => ({ health: 3 }), restore: (c) => 25 + (c.personalities.includes("Introvert") ? 10 : 0) },
  hustle: { energy: 20, stats: () => ({}), earn: (_, roll) => N(roll(8_000, 25_000)), memo: "Safe hustle" },
};

/** Returns { error } or { stats, energy, earn?, spend?, memo? }. Never mutates `c`. */
export function resolveAction(c, name, roll) {
  const a = ACTIONS[name];
  if (!a) return { error: "Unknown action." };
  if (c.energy < a.energy) return { error: "You are too tired for that. Rest first." };
  const delta = a.stats(c), out = {};
  for (const k of ["health", "happiness", "academics", "popularity", "suspicion"]) out[k] = clamp(c[k] + (delta[k] ?? 0));
  out.energy = clamp(c.energy - a.energy + (a.restore ? a.restore(c) : 0));
  return { stats: out, earn: a.earn?.(c, roll), spend: a.spend, memo: a.memo };
}

/** Parent call: once per game week. Small chance of a gift worth 20% of the class allowance. */
export function resolveCall(c, week, roll, allowance) {
  if (c.lastParentCallWeek >= week) return { error: "You already called your parent this week." };
  const gift = roll(1, 100) <= 15 ? (allowance * 20n) / 100n : 0n;
  return { happiness: clamp(c.happiness + 3), gift };
}

// ---------- Risk system (fictional game mechanics) ----------
export const gradePoint = (s) => (s >= 70 ? 5 : s >= 60 ? 4 : s >= 50 ? 3 : s >= 45 ? 2 : s >= 40 ? 1 : 0);
export const catchChance = (c) => Math.max(5, Math.min(90, 15 + c.suspicion * 0.5 - c.luck * 0.1 - (c.personalities.includes("Shana") ? 8 : 0)));

/** Risky hustle: big money or DSA. Energy and suspicion are always spent. */
export function resolveRisky(c, roll) {
  if (c.energy < 25) return { error: "You are too tired for that. Rest first." };
  const stats = { energy: clamp(c.energy - 25), suspicion: clamp(c.suspicion + 15) };
  if (roll(1, 100) <= catchChance(c)) return { caught: true, stats };
  const won = roll(1, 100) <= 30;
  return { caught: false, stats, earn: won ? N(roll(100_000, 600_000)) : 0n };
}
export const arrestStats = (c) => ({ health: clamp(c.health - 15), energy: clamp(c.energy - 25), happiness: clamp(c.happiness - 10),
  suspicion: clamp(c.suspicion - 20), popularity: clamp(c.popularity - 5) });
export const jailMinutes = (roll) => roll(30, 180);
/** Bill to leave Floor O early: 10% of cash, between N150,000 and N5,000,000. */
export const billFor = (cash) => { const b = cash / 10n, lo = N(150_000), hi = N(5_000_000); return b < lo ? lo : b > hi ? hi : b; };
/** On arrest the DSA also seizes 30% of the cash you hold (on top of any early-release bill). */
export const seizureFor = (cash) => (cash * 30n) / 100n;
export const escalate = (strikes) => (strikes >= 5 ? "EXPELLED" : strikes >= 3 ? "SUSPENDED" : "NONE");

/** Exam. Cheating can add marks, but a caught cheat caps the score and adds a strike. */
export function resolveExam(c, difficulty, cheat, roll) {
  let sc = c.academics * 0.9 + (c.energy - 50) * 0.2 + roll(-12, 12) - (difficulty - 1) * 12 + (c.luck - 50) * 0.1;
  let caught = false;
  if (cheat) { if (roll(1, 100) <= 30 + c.suspicion * 0.3 + (100 - c.luck) * 0.1) { caught = true; sc = Math.min(sc, 25); } else sc += 22; }
  const score = Math.max(0, Math.min(100, Math.round(sc)));
  return { score, gradePoint: gradePoint(score), caught,
    stats: { energy: clamp(c.energy - 20), popularity: clamp(c.popularity - (caught ? 10 : 0)), suspicion: clamp(c.suspicion + (caught ? 10 : cheat ? 8 : 0)) } };
}

// ---------- Progression (game rules, not official OAU policy) ----------
// A session is 12 game weeks with 2 exams. CGPA is the mean grade point over every exam ever sat
// (a repeated level adds more exams, so a bad session keeps weighing on you).
export const SESSION_WEEKS = 12;
export const cgpa = (gps) => (gps.length ? Math.round((gps.reduce((a, b) => a + b, 0) / gps.length) * 100) / 100 : null);
/** Standard Nigerian 5-point degree classes. */
export const classify = (g) => (g >= 4.5 ? "First Class" : g >= 3.5 ? "Second Class Upper" : g >= 2.4 ? "Second Class Lower" : g >= 1.5 ? "Third Class" : g >= 1 ? "Pass" : "Fail");

/** Decide what happens when a session ends. Two failed sessions in a row means academic withdrawal. */
export function closeSession({ level, failedSessions, sessionGps, allGps }) {
  const sessionPass = (cgpa(sessionGps) ?? 0) >= 1.0;
  if (sessionPass && level >= 500) {
    const final = cgpa(allGps) ?? 0;
    if (final >= 1.0) return { type: "GRADUATE", level, failedSessions: 0, cgpa: final, classification: classify(final) };
  } else if (sessionPass) return { type: "ADVANCE", level: level + 100, failedSessions: 0 };
  return failedSessions + 1 >= 2 ? { type: "WITHDRAWN", level, failedSessions: failedSessions + 1 } : { type: "REPEAT", level, failedSessions: failedSessions + 1 };
}