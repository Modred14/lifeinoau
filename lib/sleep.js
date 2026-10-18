// lib/sleep.js
// Sleep rules, pure. Recovery is worked out from how long the player has really been asleep on the synchronised game clock
// (1:1 with real time, see lib/campus-clock.js). The browser never sends how long it slept.
import { CAMPUS_MINUTE_MS } from "./campus-clock.js";
import { clamp } from "./engine.js";

export const SLEEP = {
  perGameMinute: 0.5,  // energy per game minute in a plain bed: 30 an hour, so 3 hours of sleep restores 90 (the clock is 1:1 with real time)
  minMinutes: 15,      // lie down for less than this and you only doze: nothing is restored
  maxMinutes: 12 * 60, // the body cannot bank more than 12 hours
  stopAt: 100,         // energy cap
  beds: { iron_bunk: 0.85, single_bed: 1, double_bed: 1.25 }, // "Rest comes back faster" in a double bed
  introvert: 1.1,
};
export const BED_KEYS = Object.keys(SLEEP.beds);
export const minutesAsleep = (sinceMs, nowMs) => Math.max(0, Math.floor((nowMs - sinceMs) / CAMPUS_MINUTE_MS));
export const sleepRate = (c, bedKey) => SLEEP.perGameMinute * (SLEEP.beds[bedKey] ?? 1) * (c.personalities?.includes("Introvert") ? SLEEP.introvert : 1);

/** What waking up at `nowMs` gives. Pure. Returns { minutes, counted, energy, restored, health, rested }. */
export function wakeResult(c, bedKey, sinceMs, nowMs) {
  const minutes = minutesAsleep(sinceMs, nowMs), counted = Math.min(minutes, SLEEP.maxMinutes);
  const restored = counted < SLEEP.minMinutes ? 0 : Math.floor(counted * sleepRate(c, bedKey));
  const energy = clamp(Math.min(SLEEP.stopAt, c.energy + restored));
  const health = counted < SLEEP.minMinutes ? c.health : clamp(c.health + Math.min(6, Math.floor(counted / 120)));
  return { minutes, counted, energy, restored: energy - c.energy, health, rested: energy >= SLEEP.stopAt };
}
/** Game minutes of sleep that would take `energy` all the way to full, in this bed (for the progress shown on the screen). */
export const minutesToFull = (c, bedKey) => Math.ceil((SLEEP.stopAt - c.energy) / sleepRate(c, bedKey));

/** Why the player cannot lie down right now, or null. `ctx` = { asleep, shift, jailed, suspended }. */
export function sleepBlock(c, ctx) {
  if (ctx.asleep) return "You are already asleep.";
  if (ctx.jailed) return "You are in QRS custody. You cannot sleep in your own bed.";
  if (ctx.shift) return "You are on a shift. Finish it before you sleep.";
  if (ctx.hustling) return "You are in the middle of a hustle.";
  if (c.energy >= SLEEP.stopAt - 4) return "You are not tired enough to sleep.";
  return null;
}