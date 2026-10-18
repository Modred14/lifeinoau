// lib/lectureResponse.js
// What happens in a lecture room after a lecturer has been knocked out, as a TIMELINE. Pure: no database, no 3D library, no timers.
//
// Everything is measured from `settledAt`, the server's own timestamp of the moment the fight was recorded. Nothing is "started" by a browser:
// the server stamps when N-QRS reaches the door and when the response is over, and every screen (including one that reconnects half way through)
// works out where in the sequence it is from the server's clock, so two screens can never disagree and a refresh can never restart it.
//
//   ARRESTED  (you won and N-QRS caught you)  dispatch, enter, rescue the lecturer, apprehend YOU, escort you out to Floor O
//   ESCAPED   (you won and slipped away)       dispatch, enter, rescue the lecturer, search the room, leave. Nobody is arrested.
//   LOST      (the lecturer won)               nobody is in danger and nobody comes: there is no response at all
//
// The lecturer is always the person being RESCUED. They are never apprehended: only the player who knocked them out can be.

export const OUTCOMES = ["LOST", "ESCAPED", "ARRESTED"];
/** How long (seconds) each step lasts. */
export const STEP_S = { dispatch: 10, enter: 12, rescue: 9, apprehend: 8, escort: 16, search: 8, leave: 8, fade: 2 };

const ORDER = {
  ARRESTED: ["dispatch", "enter", "rescue", "apprehend", "escort", "fade"],
  ESCAPED: ["dispatch", "enter", "rescue", "search", "leave"],
  LOST: [],
};

/** The steps of a response: [{ name, from, to }] in seconds from the settle time. Empty when nobody comes. */
export function phasesFor(outcome) {
  let t = 0;
  return (ORDER[outcome] ?? []).map((name) => { const p = { name, from: t, to: t + STEP_S[name] }; t += STEP_S[name]; return p; });
}
/** How long the whole response lasts (ms). 0 when nobody comes. */
export const totalMs = (outcome) => (phasesFor(outcome).at(-1)?.to ?? 0) * 1000;
/** When N-QRS reaches the front door (ms after the settle time). */
export const arriveMs = (outcome) => (outcome === "LOST" ? 0 : STEP_S.dispatch * 1000);

/** Where a response stands `elapsedMs` after it was settled: { name, from, to, t (seconds in), u (0..1 through this step), done }. */
export function phaseAt(outcome, elapsedMs) {
  const ph = phasesFor(outcome), t = Math.max(0, elapsedMs) / 1000;
  if (!ph.length) return { name: "none", from: 0, to: 0, t, u: 1, done: true };
  const last = ph[ph.length - 1];
  if (t >= last.to) return { name: "done", from: last.to, to: last.to, t: last.to, u: 1, done: true };
  const p = ph.find((x) => t >= x.from && t < x.to) ?? ph[0];
  return { ...p, t, u: (t - p.from) / (p.to - p.from), done: false };
}

/** The columns that record a settled response. `settledAt` is a ms timestamp from the server's clock. */
export function responseFields(outcome, settledAt) {
  const total = totalMs(outcome);
  if (!total) return { settledAt: new Date(settledAt), qrsArriveAt: null, responseEndsAt: null, responseState: null };
  return { settledAt: new Date(settledAt), qrsArriveAt: new Date(settledAt + arriveMs(outcome)), responseEndsAt: new Date(settledAt + total), responseState: "ACTIVE" };
}

const ms = (d) => (d == null ? null : +new Date(d));
/**
 * What a screen is told about an encounter row. `now` is the server's clock. Includes where the response stands, so a reconnecting screen knows how far in it is.
 * Returns null for an encounter that has not been settled yet.
 */
export function incidentView(row, now) {
  if (!row || row.settledAt == null || !row.outcome) return null;
  const settled = ms(row.settledAt), elapsed = now - settled, ph = phaseAt(row.outcome, elapsed), end = ms(row.responseEndsAt);
  return {
    id: String(row.id), outcome: row.outcome, courseCode: row.courseCode,
    lecturer: { key: row.lecturerKey, name: row.lecturerName },
    venue: { placeId: row.venueId, roomId: row.roomId, npcIndex: row.npcIndex ?? 0 },
    settledAt: settled, arriveAt: ms(row.qrsArriveAt), endsAt: end, elapsedMs: Math.max(0, elapsed), phase: ph.name,
    active: end != null && now < end,
    /** The lecturer is rescued in both responses; only the player is ever apprehended, and only when N-QRS caught them. */
    rescued: row.outcome !== "LOST", apprehended: row.outcome === "ARRESTED",
    ...(row.result ?? {}),
  };
}