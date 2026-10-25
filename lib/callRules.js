// lib/callRules.js
// Pure rules for the Calls app: no database, no randomness of its own (the dice are passed in), safe to import in the browser.
// Every number that decides how a parent answers, how long a call rings and how often a player may ring someone lives in this one file.
// lib/callService.js applies them on the server; the screens only read them to explain what will happen.
import { STARTING_ALLOWANCE, P2P } from "./rules.js";

// ---------- calling home ----------
export const PARENT_CALL = {
  // How a call home goes, out of 100, before the adjustments below. A call "answered" is any of REFUSED, LATER, GIVEN.
  weights: { NO_ANSWER: 10, CALL_DECLINED: 5, REFUSED: 15, LATER: 25, GIVEN: 45 },
  missedStreakShift: 5, // each week in a row without calling home moves this many points from GIVEN to REFUSED (a worried, annoyed parent) ...
  maxStreakShift: 15, // ... up to this many
  richMultiple: 3, // a player holding more than this many weeks of allowance in their account is told "you do not need it": half the GIVEN weight goes to REFUSED
  giftPct: [5, 20], // a gift is this share of the weekly allowance (the old Home button gave 20%)
  weeklyGiftCapPct: 60, // all gifts from home in one game week (this app and the Home button together) never pass this share of the allowance
  maxCallsPerWeek: 6,
  cooldownMs: { NO_ANSWER: 10 * 60_000, CALL_DECLINED: 20 * 60_000, REFUSED: 3 * 3_600_000, LATER: 90 * 60_000, GIVEN: 6 * 3_600_000 }, // before the next call home
  happiness: { GIVEN: 3, LATER: 1, REFUSED: -1, NO_ANSWER: 0, CALL_DECLINED: 0 },
  answered: ["REFUSED", "LATER", "GIVEN"], // the parent picked up and talked: this counts as the weekly "calling home", like the Home button
};
export const isAnsweredOutcome = (o) => PARENT_CALL.answered.includes(o);
/** The call's status in the database for a parent outcome. */
export const parentStatusOf = (o) => (o === "NO_ANSWER" ? "MISSED" : o === "CALL_DECLINED" ? "DECLINED" : "ENDED");

/** Mummy or Daddy: fixed for a player (taken from their id), so the same parent always answers. */
export function parentName(characterId) {
  let h = 0; for (const ch of String(characterId)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h % 2 ? "Mummy" : "Daddy";
}

/** The odds for this player right now, as whole-number weights (a copy: the constants are never changed). */
export function parentWeights({ balance = 0n, allowance = 0n, missedStreak = 0 } = {}) {
  const w = { ...PARENT_CALL.weights };
  const shift = Math.min(PARENT_CALL.maxStreakShift, PARENT_CALL.missedStreakShift * Math.max(0, missedStreak), w.GIVEN);
  w.GIVEN -= shift; w.REFUSED += shift;
  if (allowance > 0n && BigInt(balance) > allowance * BigInt(PARENT_CALL.richMultiple)) { const half = Math.floor(w.GIVEN / 2); w.GIVEN -= half; w.REFUSED += half; }
  return w;
}

/** Which outcome a roll from 0 to (total - 1) lands on. */
export function pickOutcome(weights, r) {
  let at = 0;
  for (const [name, w] of Object.entries(weights)) { at += w; if (r < at) return name; }
  return "REFUSED";
}

/** Round kobo down to a whole ₦100 (a parent sends round sums). */
const roundDown100 = (k) => (BigInt(k) / 10_000n) * 10_000n;

/**
 * What a call home comes to. `roll(min, max)` returns a whole number from min to max inclusive (lib/rng.js in the game, a fixed one in tests).
 * givenThisWeek: kobo already sent from home this game week (any road). Returns { outcome, giftKobo, line, happiness }.
 */
export function resolveParentCall({ allowance, balance = 0n, missedStreak = 0, givenThisWeek = 0n, roll }) {
  const allow = BigInt(allowance), w = parentWeights({ balance, allowance: allow, missedStreak });
  const total = Object.values(w).reduce((t, x) => t + x, 0);
  let outcome = pickOutcome(w, roll(0, total - 1)), giftKobo = 0n, why = null;
  if (outcome === "GIVEN") {
    const [lo, hi] = PARENT_CALL.giftPct, want = roundDown100((allow * BigInt(roll(lo, hi))) / 100n);
    const room = roundDown100((allow * BigInt(PARENT_CALL.weeklyGiftCapPct)) / 100n - BigInt(givenThisWeek)), least = roundDown100((allow * BigInt(lo)) / 100n);
    if (room < least || room <= 0n) { outcome = "LATER"; why = "budget"; } // home has already sent a lot this week
    else giftKobo = want < room ? want : room;
    if (giftKobo === 0n && outcome === "GIVEN") { outcome = "LATER"; why = "budget"; }
  }
  const line = lineFor(outcome, why, roll);
  return { outcome, giftKobo, line, happiness: PARENT_CALL.happiness[outcome] ?? 0 };
}

const LINES = {
  NO_ANSWER: ["It rings and rings. Nobody picks up.", "No answer. Maybe they are out. Try again later."],
  CALL_DECLINED: ["The call was cut. They are busy right now.", "They declined the call. Try again in a while."],
  REFUSED: ["\"Again? You have your allowance. Manage it well.\"", "\"No, my dear. Learn to budget what we already send you.\"", "\"Not this time. Concentrate on your books.\""],
  LATER: ["\"Ah, I just spent a lot. Call me again later.\"", "\"Money is tight this week. Try me again later, okay?\"", "\"Let me check the account and call you back. Try again later.\""],
  LATER_budget: ["\"I have already sent you a lot this week. Call me again next week.\""],
  GIVEN: ["\"Take it, and use it well. I am proud of you.\"", "\"I have sent a little something. Eat well and study hard.\"", "\"Okay, okay. Check your account.\""],
};
function lineFor(outcome, why, roll) {
  const list = LINES[why ? `${outcome}_${why}` : outcome] ?? LINES[outcome];
  return list[roll(0, list.length - 1)];
}

/** Milliseconds until this player may call home again, from their most recent call home ({ createdAt, outcome }). 0 = they may call now. */
export function parentCooldownLeft(last, now = Date.now()) {
  if (!last) return 0;
  const wait = PARENT_CALL.cooldownMs[last.outcome] ?? PARENT_CALL.cooldownMs.REFUSED;
  return Math.max(0, wait - (now - new Date(last.createdAt).getTime()));
}

/** "2h 5m" / "12m" / "40s" for a wait in ms (rounds up, so "0s" is never shown while a wait remains). */
export function waitLabel(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** The weekly allowance (kobo) for a class, the base for every gift. */
export const allowanceFor = (cls) => STARTING_ALLOWANCE[cls] ?? STARTING_ALLOWANCE.LAPO;

// ---------- calling a player ----------
export const PLAYER_CALL = {
  ringMs: 30_000, // rings this long, then it is a missed call
  idleMs: 120_000, // an answered call where nobody asks for money hangs up by itself after this
  askMs: 60_000, // the other player has this long to approve or reject a request for money
  onlineMs: 25_000, // a player whose game was open this recently can be called (the phone polls every few seconds)
  resultShowMs: 90_000, // how long the end of a call (money sent, declined, ...) stays on screen for the other side
  redialMissMs: 60_000, // after a call that was not answered, wait this long before ringing the same player again
  redialNoMs: 15 * 60_000, // after a player declined your call or turned down your request, wait this long before asking them again
  callsPerHour: 12, // calls started, to anyone
  asksPerDay: 6, // requests for money, to anyone
  asksPerPairPerDay: 3, // requests for money to the same player
  missedNoteMs: 10 * 60_000, // an offline player gets at most one "missed call" note from the same caller in this time
  askMinNaira: P2P.minNaira, askMaxNaira: P2P.maxNaira, // the same limits as sending money in Messages: an approved request is an ordinary transfer
  note: "call request", // what shows on both statements
};

export const LIVE = ["RINGING", "ANSWERED"];
export const isLive = (call) => LIVE.includes(call?.status);
const t = (d) => (d ? new Date(d).getTime() : 0);

/** Whether a player seen at `seenAt` can be rung now. */
export const isOnline = (seenAt, now = Date.now()) => !!seenAt && now - t(seenAt) <= PLAYER_CALL.onlineMs;

/**
 * If a live call has run out of time, what it turns into (else null). The server applies this the moment either side next looks at the call,
 * so no timer or background job is needed and a call can never stay "ringing" forever.
 */
export function expiryOf(call, now = Date.now()) {
  if (!isLive(call)) return null;
  if (call.status === "RINGING" && now >= t(call.ringUntil)) return { status: "MISSED", endReason: "NO_ANSWER", at: t(call.ringUntil) };
  if (call.status === "ANSWERED") {
    if (call.askStatus === "PENDING" && now >= t(call.askUntil)) return { status: "ENDED", endReason: "NO_RESPONSE", askStatus: "EXPIRED", at: t(call.askUntil) };
    if (call.askStatus === "NONE" && now >= t(call.idleUntil)) return { status: "ENDED", endReason: "TIMEOUT", at: t(call.idleUntil) };
  }
  return null; // `at` (ms) is the moment it actually ran out, which is when the call is recorded as ended
}

/**
 * Why this caller may not ring this player right now (a sentence), or null. `facts` come from the database:
 *  { callsLastHour, lastToPeer: { status, askStatus, createdAt, endedAt } | null }
 */
export function dialBlock({ callsLastHour = 0, lastToPeer = null, peerName = "this player" }, now = Date.now()) {
  if (callsLastHour >= PLAYER_CALL.callsPerHour) return "You have made a lot of calls this hour. Take a short break.";
  if (lastToPeer) {
    const at = t(lastToPeer.endedAt ?? lastToPeer.createdAt), since = now - at;
    const turnedDown = lastToPeer.status === "DECLINED" || lastToPeer.askStatus === "REJECTED";
    const wait = turnedDown ? PLAYER_CALL.redialNoMs : ["MISSED", "CANCELLED"].includes(lastToPeer.status) ? PLAYER_CALL.redialMissMs : 0;
    if (wait && since < wait) return turnedDown ? `${peerName} is not taking your calls right now. Try again in ${waitLabel(wait - since)}.` : `You just tried ${peerName}. Try again in ${waitLabel(wait - since)}.`;
  }
  return null;
}

/** Why this caller may not ask for money now, or null. `facts`: { asksToday, asksToPeerToday }. */
export function askBlock({ asksToday = 0, asksToPeerToday = 0 }) {
  if (asksToday >= PLAYER_CALL.asksPerDay) return "You have asked for money a lot today. Try again tomorrow.";
  if (asksToPeerToday >= PLAYER_CALL.asksPerPairPerDay) return "You have already asked this player for money a few times today.";
  return null;
}
