// lib/engine.js
// Pure game rules: no database, no I/O, so they are easy to test. Randomness is injected.
export const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const N = (n) => BigInt(n) * 100n; // naira -> kobo

/** The hustle rules in one place (the server enforces them, the screens only read them). Money is in naira here. */
export const HUSTLE = {
  safe: { min: 1_500, max: 15_000, energy: 20, perDay: 2, gapMs: 6 * 3_600_000 }, // twice per in-game day, at least 6 hours apart
  risky: { min: 100_000, max: 500_000, energy: 25, perDay: 1, jailMin: 30, jailMax: 90 }, // once per in-game day; jail is minutes
  bailPerMinute: 3_500, // naira, per minute of the sentence still to serve
};

// Each action: energy cost, stat changes, and an optional money effect.
export const ACTIONS = {
  class:  { energy: 12, stats: (c) => ({ academics: 4, popularity: c.personalities.includes("Introvert") ? 0 : 1 }) },
  study:  { energy: 15, stats: () => ({ academics: 6, happiness: -2 }) },
  rest:   { energy: 0,  stats: (c) => ({ health: 3 }), restore: (c) => 25 + (c.personalities.includes("Introvert") ? 10 : 0) },
  hustle: { energy: HUSTLE.safe.energy, stats: () => ({}), earn: (_, roll) => N(roll(HUSTLE.safe.min, HUSTLE.safe.max)), memo: "Safe hustle" },
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

/** Parent call: once per week. Small chance of a gift worth 20% of the class allowance. */
export function resolveCall(c, week, roll, allowance) {
  if (c.lastParentCallWeek >= week) return { error: "You already called your parent this week." };
  const gift = roll(1, 100) <= 15 ? (allowance * 20n) / 100n : 0n;
  return { happiness: clamp(c.happiness + 3), gift };
}

// ---------- Risk system (fictional game mechanics) ----------
export const gradePoint = (s) => (s >= 70 ? 5 : s >= 60 ? 4 : s >= 50 ? 3 : s >= 45 ? 2 : s >= 40 ? 1 : 0);
/** Every risky thing in the game (risky hustle, backstairs run, brawling a lecturer, cheating in an exam): 70% you are caught, 30% you get away with it. Flat: stats do not move it. */
export const CATCH_PERCENT = 70;
export const catchChance = () => CATCH_PERCENT;

/** Risky hustle: one of two outcomes. N-QRS catches you (jail), or you walk away with N100,000 to N500,000. Energy and suspicion are always spent. */
export function resolveRisky(c, roll) {
  if (c.energy < HUSTLE.risky.energy) return { error: "You are too tired for that. Rest first." };
  const stats = { energy: clamp(c.energy - HUSTLE.risky.energy), suspicion: clamp(c.suspicion + 15) };
  if (roll(1, 100) <= catchChance(c)) return { caught: true, stats };
  return { caught: false, stats, earn: N(roll(HUSTLE.risky.min, HUSTLE.risky.max)) };
}

// ---- Hustle limits and bail (all decided on the server; the screens use the same functions only to show what will happen) ----
/**
 * Where a player stands today, from their hustle ActionLog rows ({ action: "hustle" | "risky", createdAt }) and the bounds of the
 * in-game day (ms). Times are returned in ms.
 *   safeLeft / riskyLeft   attempts still allowed in this in-game day
 *   safeGapEndsAt          when 6 hours have passed since the last safe hustle (null if never): the gap holds across midnight
 *   resetsAt               when the next in-game day starts and the daily counts reset
 */
/** The break between two safe hustles is a quarter of an in-game day: 6 hours on a 24 hour day, 12 real minutes on the 48 minute campus day. */
export const gapFor = (dayStart, dayEnd) => Math.min(HUSTLE.safe.gapMs, (dayEnd - dayStart) / 4);
export function hustleStatus(logs, dayStart, dayEnd) {
  const at = (l) => +new Date(l.createdAt), safe = logs.filter((l) => l.action === "hustle").map(at), risky = logs.filter((l) => l.action === "risky").map(at);
  const used = (a) => a.filter((t) => t >= dayStart && t < dayEnd).length;
  const last = safe.length ? Math.max(...safe) : null;
  return { safeUsed: used(safe), safeLeft: Math.max(0, HUSTLE.safe.perDay - used(safe)), safeGapEndsAt: last == null ? null : last + gapFor(dayStart, dayEnd),
    riskyUsed: used(risky), riskyLeft: Math.max(0, HUSTLE.risky.perDay - used(risky)), resetsAt: dayEnd };
}
/** "5h 59m", "42m", "30s": for the cooldown messages. */
export const waitText = (ms) => { if (ms > 0 && ms < 60_000) return `${Math.ceil(ms / 1000)}s`; const m = Math.ceil(Math.max(0, ms) / 60_000); return m < 1 ? "a moment" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
/** The hustle counts as they stand at `now`: a day that has ended resets the daily counts (the screens may hold an older answer). */
const effective = (s, now) => (now >= s.resetsAt ? { ...s, safeLeft: HUSTLE.safe.perDay, riskyLeft: HUSTLE.risky.perDay } : s);
/** When the next safe hustle is allowed (ms), or `now` if it is allowed now. */
export function safeHustleAt(s, now) {
  const e = effective(s, now), gap = e.safeGapEndsAt ?? 0;
  return Math.max(now, gap, e.safeLeft > 0 ? 0 : e.resetsAt);
}
/** null if this hustle may be tried now, otherwise why not. `kind` is "safe" or "risky". */
export function hustleBlock(kind, status, now = Date.now()) {
  const e = effective(status, now);
  if (kind === "risky") return e.riskyLeft > 0 ? null : `You already tried a risky hustle today. Next one in ${waitText(e.resetsAt - now)}.`;
  const at = safeHustleAt(status, now);
  if (at <= now) return null;
  return e.safeLeft <= 0 ? `You have used both safe hustles today. Next one in ${waitText(at - now)}.` : `Safe hustle needs a 6 hour break. Next one in ${waitText(at - now)}.`;
}
/** Bail: N3,500 for every minute of the sentence still to serve (a started minute counts), in kobo. It falls N3,500 each minute served and is 0 once the time is up. */
export const bailFor = (releaseAt, now = Date.now()) => {
  const ms = +new Date(releaseAt) - +now;
  return ms > 0 ? BigInt(Math.ceil(ms / 60_000)) * N(HUSTLE.bailPerMinute) : 0n;
};
export const arrestStats = (c) => ({ health: clamp(c.health - 15), energy: clamp(c.energy - 25), happiness: clamp(c.happiness - 10),
  suspicion: clamp(c.suspicion - 20), popularity: clamp(c.popularity - 5) });
export const jailMinutes = (roll) => roll(30, 180); // fighting a lecturer
/** Sentence for a caught risky hustle: 30 minutes to 1 hour 30 minutes. */
export const riskyJailMinutes = (roll) => roll(HUSTLE.risky.jailMin, HUSTLE.risky.jailMax);
/** On arrest the QRS also seizes 30% of the cash you hold (on top of any early-release bill). */
export const seizureFor = (cash) => (cash * 30n) / 100n;
export const escalate = (strikes) => (strikes >= 5 ? "EXPELLED" : strikes >= 3 ? "SUSPENDED" : "NONE");

/** Exam. Cheating can add marks, but a caught cheat caps the score and adds a strike. */
export function resolveExam(c, difficulty, cheat, roll) {
  let sc = c.academics * 0.9 + (c.energy - 50) * 0.2 + roll(-12, 12) - (difficulty - 1) * 12 + (c.luck - 50) * 0.1;
  let caught = false;
  if (cheat) { if (roll(1, 100) <= CATCH_PERCENT) { caught = true; sc = Math.min(sc, 25); } else sc += 22; }
  const score = Math.max(0, Math.min(100, Math.round(sc)));
  return { score, gradePoint: gradePoint(score), caught,
    stats: { energy: clamp(c.energy - 20), popularity: clamp(c.popularity - (caught ? 10 : 0)), suspicion: clamp(c.suspicion + (caught ? 10 : cheat ? 8 : 0)) } };
}

// ---------- Progression (game rules, not official OAU policy) ----------
// A session is 12 weeks with 2 exams. CGPA is the mean grade point over every exam ever sat
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