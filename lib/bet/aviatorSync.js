// lib/bet/aviatorSync.js
// How a screen follows a flight whose crash point the server decided BEFORE take-off. PURE (browser + server + tests share it).
// The server hands over the round (id, start time, crash point in hundredths) once. From then on the screen only walks the shared curve
// (aviatorMath.centiAt) and stops AT the server's crash point: it can never show more, and it never has to be corrected afterwards.
// Everything is whole hundredths (396 = 3.96x), so there is no float to round differently on the two sides.
import { centiAt, secAt } from "./aviatorMath.js";

/** Milliseconds into the flight at which the plane reaches `crash` (hundredths). */
export const crashMs = (crash) => secAt(crash) * 1000;

/** The multiplier (hundredths) to DRAW `elapsedMs` into the flight: the shared curve, never above the server's crash point. */
export const centiShown = (elapsedMs, crash) => Math.min(crash, centiAt(Math.max(0, elapsedMs) / 1000));

/** True once the plane has reached the server's crash point. From that moment the screen shows exactly `crash`. */
export const crashDue = (elapsedMs, crash) => elapsedMs >= crashMs(crash);

/** What to show at `elapsedMs`: the curve until the crash point is reached, then exactly the crash point. */
export const frameCenti = (elapsedMs, crash) => (crashDue(elapsedMs, crash) ? crash : centiShown(elapsedMs, crash));

/** Is this a round the server could really have sent? (No guesses: a round without a whole-number crash point is never animated.) */
export const validRound = (r) => !!r && typeof r.id === "string" && Number.isFinite(r.startedAt) && Number.isInteger(r.crashCenti) && r.crashCenti >= 100 && /^\d+$/.test(String(r.stakeKobo));

/** Build the screen's flight from the server's round. `perfNow` is performance.now(); `rtt` the round trip of the request that carried it. */
export function makeFlight(round, serverNow, perfNow, rtt = 0) {
  if (!validRound(round)) return null;
  const age = Math.max(0, serverNow - round.startedAt) + Math.min(400, rtt / 2), stakeKobo = BigInt(round.stakeKobo);
  return {
    id: round.id, t0: perfNow - age, stake: Number(stakeKobo / 100n), stakeKobo, autoCenti: round.autoCenti, cashed: null,
    crash: round.crashCenti, crashAt: perfNow - age + crashMs(round.crashCenti), // fixed for the whole flight: nothing ever moves them
    crashShown: 0, settled: false, seq: 0, applied: 0, lastNow: 0, link: true,
  };
}

/** Out-of-order, duplicate and stale answers must not touch the flight. `seq` is the number this request was given when it was sent. */
export function accept(flight, ev) {
  if (!flight || flight.done) return false;
  if (ev.round && (ev.round.id !== flight.id || ev.round.crashCenti !== flight.crash)) return false; // another round's event, or a crash point that is not the one handed over
  if (ev.last && ev.last.id === flight.id && ev.last.crashCenti !== flight.crash) return false;
  if (ev.seq <= flight.applied) return false; // an older request answering after a newer one
  if (Number.isFinite(ev.now) && ev.now < flight.lastNow) return false; // the server's clock never runs backwards
  flight.applied = ev.seq; if (Number.isFinite(ev.now)) flight.lastNow = ev.now;
  return true;
}
