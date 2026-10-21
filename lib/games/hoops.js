// lib/games/hoops.js
// Basketball: a shooting contest for two. Each player takes five shots in turn, picking a range and then stopping a moving meter on the green zone.
// The SERVER keeps the clock for the meter (it stamps when the meter started), checks the release against its own time, and then decides whether the
// ball goes in with its own random number: a screen can never claim a basket. Better timing raises the chance, it never makes a shot certain.
// Higher score after five shots each wins; a tie goes to sudden death (one extra shot each until someone leads, then a draw after five extra pairs).
import { RuleError, need } from "./errors.js";

export const info = { id: "HOOPS", name: "Basketball", blurb: "Pick your range, time your release and outscore your rival.", icon: "ball", turnSeconds: 60, seats: 2 };

export const ROUNDS = 5, SUDDEN_PAIRS = 5, PERIOD_MS = 1400;
/** Range: points, the chance with the worst release (base), what perfect timing adds (gain), and how wide the green zone is on the 0..1 meter. */
export const SPOTS = {
  LAYUP: { label: "Layup", pts: 2, base: 0.5, gain: 0.42, zone: 0.3 },
  THREE: { label: "Three-pointer", pts: 3, base: 0.22, gain: 0.48, zone: 0.22 },
  HALF: { label: "Half court", pts: 4, base: 0.08, gain: 0.42, zone: 0.16 },
};
const HOT = 2; // makes in a row before a shot is "on fire" and earns a bonus point

/** Where the moving meter is (0..1, up and down) this many milliseconds after it started. */
export const meterAt = (ms) => { const x = ((ms % PERIOD_MS) + PERIOD_MS) % PERIOD_MS / PERIOD_MS; return 1 - Math.abs(2 * x - 1); };
/** How good a release was (0..1): 1 in the middle of the green zone, 0.5 at its edge, 0 well outside. */
export const quality = (m, zoneAt, zone) => Math.max(0, Math.min(1, 1 - Math.abs(m - zoneAt) / zone));
export const chance = (spot, q) => Math.min(0.95, SPOTS[spot].base + SPOTS[spot].gain * q);

export function create(rng) {
  const turn = rng() < 0.5 ? 0 : 1;
  return { turn, first: turn, score: [0, 0], streak: [0, 0], shots: [0, 0], phase: "pick", spot: null, zoneAt: null, meterStart: null, history: [], sudden: 0, last: null };
}
export const turnOf = (st) => st.turn;

const grade = (q) => (q >= 0.85 ? "Perfect release" : q >= 0.5 ? "Good release" : q > 0.12 ? "Poor release" : "Bad release");

/** { type: "pick", spot: "LAYUP" | "THREE" | "HALF" } then { type: "release", elapsed (ms since you saw the meter start) }. */
export function act(state, seat, action, ctx = {}) {
  need(seat === state.turn, "It is not your turn.");
  const st = { ...state, score: [...state.score], streak: [...state.streak], shots: [...state.shots], history: [...state.history] }, rng = ctx.rng ?? Math.random, now = ctx.now ?? Date.now();
  if (action?.type === "pick") {
    need(st.phase === "pick", "Release the shot you are taking.");
    need(Object.hasOwn(SPOTS, action.spot), "Pick a range.");
    const zone = SPOTS[action.spot].zone;
    Object.assign(st, { phase: "meter", spot: action.spot, zoneAt: Math.round((zone / 2 + 0.05 + rng() * (0.9 - zone)) * 1000) / 1000, meterStart: now });
    return { state: st, over: null };
  }
  if (action?.type === "release") {
    need(st.phase === "meter", "Pick a range first.");
    const claimed = Number(action.elapsed); need(Number.isFinite(claimed), "That release could not be read.");
    const seen = now - st.meterStart; // what the server saw: the browser's number is only believed within what delay could explain
    const used = Math.max(seen - 900, Math.min(seen + 60, claimed));
    const spot = SPOTS[st.spot], m = meterAt(used), q = claimed < 120 ? 0 : quality(m, st.zoneAt, spot.zone);
    const p = chance(st.spot, q), made = rng() < p, fire = made && st.streak[seat] >= HOT, pts = made ? spot.pts + (fire ? 1 : 0) : 0;
    st.score[seat] += pts; st.streak[seat] = made ? st.streak[seat] + 1 : 0; st.shots[seat]++;
    const shot = { seat, spot: st.spot, made, pts, fire, q: Math.round(q * 100) / 100, grade: grade(q), m: Math.round(m * 100) / 100 };
    st.history.push(shot); st.last = shot; Object.assign(st, { phase: "pick", spot: null, zoneAt: null, meterStart: null });
    st.turn = 1 - seat;
    // both have shot the same number of times: decide, or carry on
    if (st.shots[0] === st.shots[1]) {
      const done = st.shots[0], lead = st.score[0] - st.score[1];
      if (done >= ROUNDS) {
        if (lead !== 0) return { state: st, over: { winner: lead > 0 ? 0 : 1, reason: `Final score ${st.score[0]} to ${st.score[1]}.` } };
        st.sudden = done - ROUNDS + 1;
        if (st.sudden > SUDDEN_PAIRS) return { state: st, over: { winner: null, reason: `Still level at ${st.score[0]} after sudden death.` } };
      }
    }
    // the player who shoots first stays the same all game
    st.turn = st.shots[0] === st.shots[1] ? st.first : 1 - st.first;
    return { state: st, over: null };
  }
  throw new RuleError("Pick a range, then release the shot.");
}

export function view(state, seat) {
  return { turn: state.turn, score: state.score, shots: state.shots, streak: state.streak, phase: state.phase, spot: state.spot, zoneAt: state.zoneAt,
    zone: state.spot ? SPOTS[state.spot].zone : null, meterStart: state.meterStart, period: PERIOD_MS, history: state.history.slice(-12), last: state.last, rounds: ROUNDS, sudden: state.sudden, first: state.first,
    spots: Object.fromEntries(Object.entries(SPOTS).map(([k, v]) => [k, { label: v.label, pts: v.pts, zone: v.zone }])) };
}
