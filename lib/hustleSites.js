// lib/hustleSites.js
// The two hustles, now done in person. Pure rules: no database. The money, energy, daily limits and N-QRS odds are exactly the ones in
// lib/engine.js (HUSTLE, resolveRisky, catchChance); this file only adds WHERE and HOW LONG, and the words.
//
//   crew        was "Safe hustle".  Oduduwa Hall hosts convocations, concerts and matric ceremonies, and always needs hands: ushers, seat setters, AV crew.
//   backstairs  was "Risky hustle". The SUB is where the unofficial business happens, and where the N-QRS patrols: moving goods and "special deals" by the back stairs.
import { HUSTLE, resolveRisky, resolveAction, catchChance } from "./engine.js";
import { CAMPUS_MINUTE_MS } from "./campus-clock.js";

export const SITES = {
  crew: { hustle: "safe", log: "hustle", place: "oduduwa", name: "Oduduwa Hall event crew", where: "Oduduwa Hall", desk: "Stewards' desk", gameMinutes: 20,
    blurb: "An event is on in the hall and the stewards need hands. Show up, stay for the whole run and you are paid when the crowd leaves." },
  backstairs: { hustle: "risky", log: "risky", place: "sub", name: "Backstairs runs", where: "the Student Union Building", desk: "Back stairwell", gameMinutes: 10,
    blurb: "Someone on the back stairs has a package that has to move before the QRS patrol comes round. Big money if it goes well. If the N-QRS catches you, it is Floor O." },
};
export const SITE_KINDS = Object.keys(SITES);
export const siteOfPlace = (placeId) => SITE_KINDS.find((k) => SITES[k].place === placeId) ?? null;
export const runMs = (kind) => SITES[kind].gameMinutes * CAMPUS_MINUTE_MS;
export const siteRules = (kind) => (kind === "crew" ? HUSTLE.safe : HUSTLE.risky);

/** What the crew lead hands you, by what the night pays: ushering is the least, the AV desk the most. */
export const crewRole = (naira) => (naira >= 9_000 ? "AV and stage crew" : naira >= 4_500 ? "Usher" : "Seat setter");
/** The patrol risk as a word. The exact odds stay on the server. */
export const riskWord = (c) => { const p = catchChance(c); return p < 18 ? "Low" : p < 35 ? "Moderate" : "High"; };

/**
 * One run, as it would start now. Returns { error } or { energyCost, stats, caught, payKobo, endsAtMs, role? }.
 * The result of the run is decided here, at the start, and stored: a refresh, a second tab or leaving and coming back cannot re-roll it.
 */
export function beginRun(c, kind, nowMs, roll) {
  const site = SITES[kind]; if (!site) return { error: "Unknown activity." };
  const endsAtMs = nowMs + runMs(kind);
  if (kind === "crew") {
    const r = resolveAction(c, "hustle", roll); if (r.error) return { error: r.error };
    const naira = Number(r.earn / 100n);
    return { energyCost: HUSTLE.safe.energy, stats: r.stats, caught: false, payKobo: r.earn, endsAtMs, role: crewRole(naira) };
  }
  const r = resolveRisky(c, roll); if (r.error) return { error: r.error };
  return { energyCost: HUSTLE.risky.energy, stats: r.stats, caught: !!r.caught, payKobo: r.caught ? 0n : r.earn, endsAtMs };
}