// lib/sleep.js
// Sleep rules, pure. A full sleep takes one activity length (ACTIVITY_SECONDS, 15 REAL seconds) and takes energy from 0 to 100 (less if you start higher: it stops at 100).
// Recovery is worked out from how long the player has really been asleep. The browser never sends how long it slept:
// the server uses these same functions with the time it saw you lie down.
import { CAMPUS_MINUTE_MS } from "./campus-clock.js";
import { clamp } from "./engine.js";
import { ACTIVITY_MS } from "./activityTime.js";

const FULL_MS = ACTIVITY_MS; // 0 -> 100 energy

export const SLEEP = {
  durationMs: FULL_MS,
  perSecond: 100 / (FULL_MS / 1000), // energy per real second in any bed (6.67)
  perGameMinute: (100 / (FULL_MS / 1000)) * 60, // kept for older callers: energy per real minute (the game clock is 1:1 with real time)
  graceMs: 1500, // the SERVER forgives this much at the end, for the time a request takes. Never used for the on-screen estimate.
  minMinutes: 0, // no minimum: even a few seconds of sleep gives something
  maxMinutes: FULL_MS / 60000,
  stopAt: 100, // energy cap
  beds: { iron_bunk: 1, single_bed: 1, double_bed: 1 }, // every bed is the same speed now: one activity length (15 seconds) to full
  introvert: 1,
};
export const BED_KEYS = Object.keys(SLEEP.beds);

/** A timestamp as milliseconds, whether the server sent a number or an ISO string. */
export const toMs = (v) => (typeof v === "number" ? v : +new Date(v));
export const secondsAsleep = (since, nowMs) => Math.max(0, (nowMs - toMs(since)) / 1000);
export const minutesAsleep = (sinceMs, nowMs) => Math.max(0, Math.floor((nowMs - toMs(sinceMs)) / CAMPUS_MINUTE_MS));
/** Energy gained per real second asleep. */
export const sleepRate = (c, bedKey) => SLEEP.perSecond * (SLEEP.beds[bedKey] ?? 1) * (c.personalities?.includes("Introvert") ? SLEEP.introvert : 1);
/** Milliseconds of sleep that take `c.energy` all the way to full (never more than the 15-second maximum). */
export const msToFull = (c, bedKey) =>
  Math.min(SLEEP.durationMs, Math.max(0, Math.ceil(((SLEEP.stopAt - c.energy) / sleepRate(c, bedKey)) * 1000)));
export const minutesToFull = (c, bedKey) => Math.ceil(msToFull(c, bedKey) / 60000);

/** What waking up at `nowMs` gives. Pure. Returns { ms, seconds, minutes, energy, restored, health, rested }.
 *  `graceMs` is only passed by the server: if you are within that much of the natural end of the sleep, it counts as the end. */
export function wakeResult(c, bedKey, sinceMs, nowMs, graceMs = 0) {
  const end = msToFull(c, bedKey),
    raw = Math.max(0, nowMs - toMs(sinceMs)),
    ms = Math.min(SLEEP.durationMs, raw + graceMs >= end ? Math.max(raw, end) : raw),
    need = Math.max(0, SLEEP.stopAt - c.energy),
    restored0 = Math.min(need, Math.floor((ms / 1000) * sleepRate(c, bedKey) + 1e-9)),
    energy = clamp(Math.min(SLEEP.stopAt, c.energy + restored0)),
    health = clamp(c.health + Math.min(6, Math.floor(ms / 5000))); // a little health back: +1 for every 5 seconds, up to +6
  return { ms, seconds: ms / 1000, minutes: Math.floor(ms / 60000), counted: ms / 60000, energy, restored: energy - c.energy, health, rested: energy >= SLEEP.stopAt };
}

/** Why the player cannot lie down right now, or null. `ctx` = { asleep, shift, jailed, suspended }. */
export function sleepBlock(c, ctx) {
  if (ctx.asleep) return "You are already asleep.";
  if (ctx.jailed) return "You are in QRS custody. You cannot sleep in your own bed.";
  if (ctx.shift) return "You are on a shift. Finish it before you sleep.";
  if (ctx.hustling) return "You are in the middle of a hustle.";
  if (c.energy >= SLEEP.stopAt - 4) return "You are not tired enough to sleep.";
  return null;
}