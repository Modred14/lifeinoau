// lib/fight.js
// Pure rules for fighting a lecturer (fictional game mechanics). The brawl itself is played in the browser (lib/fightSim.js);
// the server only checks that the report is believable and decides what it costs you. Randomness is injected.
import { clamp, arrestStats } from "./engine.js";

export const FIGHT_ENERGY = 20;
/** After you beat a lecturer, this is the chance (in percent) that the QRS van comes for you. */
export const DSA_CATCH_PERCENT = 80;
export const MIN_FIGHT_MS = 2500;

/** The browser's report of the brawl, made safe: a plain { won, ms, landed, taken } or null if it makes no sense. */
export function cleanReport(r) {
  if (!r || typeof r !== "object") return null;
  const n = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : null);
  const ms = n(r.ms, 0, 10 * 60_000), landed = n(r.landed, 0, 200), taken = n(r.taken, 0, 200);
  if (ms == null || landed == null || taken == null || typeof r.won !== "boolean") return null;
  return { won: r.won, ms, landed, taken };
}

/**
 * What a fight does. Returns { error } or
 *  { won: false, stats }                       you lost: bruised and humiliated, nobody comes
 *  { won: true, caught: false, stats }         you won and slipped away
 *  { won: true, caught: true, stats }          you won and the QRS van came (stats are the arrest stats; the caller seizes cash and jails you)
 * A win has to look like one: enough time passed and enough punches landed to knock out a lecturer.
 */
export function resolveFight(c, report, roll) {
  const rep = cleanReport(report);
  if (!rep) return { error: "That fight did not make sense." };
  if (c.energy < FIGHT_ENERGY) return { error: "You are too tired to fight. Rest first." };
  const tired = { energy: clamp(c.energy - FIGHT_ENERGY) };
  if (!rep.won) {
    return { won: false, stats: { ...tired, health: clamp(c.health - 20), happiness: clamp(c.happiness - 10), popularity: clamp(c.popularity - 5) } };
  }
  if (rep.ms < MIN_FIGHT_MS || rep.landed < 5) return { error: "That fight did not make sense." };
  const caught = roll(1, 100) <= DSA_CATCH_PERCENT;
  if (!caught) {
    return { won: true, caught: false, stats: { ...tired, happiness: clamp(c.happiness + 15), popularity: clamp(c.popularity + 8), suspicion: clamp(c.suspicion + 25) } };
  }
  return { won: true, caught: true, stats: arrestStats(c) };
}