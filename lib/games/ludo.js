// lib/games/ludo.js
// Ludo for two players, decided entirely on the server: the dice are rolled here (never by the browser), only legal moves are accepted, and the
// screen is given the same geometry (TRACK, HOME_COLUMN, ...) so it draws exactly what the rules use.
//
// Rules: roll a 6 to bring a token out of the yard. A token walks 51 squares round the board and then up its own home column; it needs the exact
// number to reach home. Landing on a lone opponent token sends it back to the yard, except on a safe square (the start squares and the stars).
// A 6 gives another roll, but three 6s in a row lose the turn. First to bring all four tokens home wins.
import { RuleError, need } from "./errors.js";

export const info = { id: "LUDO", name: "Ludo", blurb: "Roll, race and capture. First to bring all four tokens home wins.", icon: "dice", turnSeconds: 90, seats: 2 };

/** The 52 squares of the loop on the 15x15 board as [column, row], clockwise, starting at the left arm's top row. */
export const TRACK = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8], [0, 7], [0, 6],
];
/** Where each seat enters the loop (index into TRACK). Seat 0 is red, seat 1 is yellow: opposite corners. */
export const START = [0, 26];
/** The five squares of each seat's home column, in walking order, then the centre. */
export const HOME_COLUMN = [[[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]];
export const CENTRE = [7, 7];
/** Safe squares (indexes of TRACK): the four start squares and the star square eight steps after each. */
export const SAFE = new Set([0, 13, 26, 39, 8, 21, 34, 47]);
/** Where each yard token rests on the board (seat, token). */
export const YARD = [[[2, 2], [4, 2], [2, 4], [4, 4]], [[10, 10], [12, 10], [10, 12], [12, 12]]];
export const HOME = 57; // progress of a token that has finished
export const COLORS = ["#d64545", "#e3b83a"];

/** progress 1..51: the TRACK index that progress stands on for a seat, or -1 when the token is in the yard, on the home column or home. */
export const trackIndex = (seat, p) => (p >= 1 && p <= 51 ? (START[seat] + p - 1) % 52 : -1);
/** The [column, row] a token is drawn at. */
export function cell(seat, token, p) {
  if (p === 0) return YARD[seat][token];
  if (p <= 51) return TRACK[trackIndex(seat, p)];
  if (p < HOME) return HOME_COLUMN[seat][p - 52];
  return CENTRE;
}

export function create(rng) {
  const turn = rng() < 0.5 ? 0 : 1;
  return { turn, tokens: [[0, 0, 0, 0], [0, 0, 0, 0]], dice: null, sixes: 0, phase: "roll", log: [], last: null, moves: 0 };
}
export const turnOf = (st) => st.turn;

/** Which tokens of `seat` can move by `dice`. */
export function movable(st, seat, dice) {
  const out = [];
  st.tokens[seat].forEach((p, i) => {
    if (p === HOME) return;
    if (p === 0) { if (dice === 6) out.push(i); return; }
    if (p + dice <= HOME) out.push(i);
  });
  return out;
}

const copy = (st) => ({ ...st, tokens: st.tokens.map((t) => [...t]), log: [...st.log] });
const note = (st, text) => { st.log.push(text); if (st.log.length > 12) st.log.shift(); };

/** { type: "roll" } or { type: "move", token: 0..3 }. `rng()` gives the dice. */
export function act(state, seat, action, ctx = {}) {
  need(seat === state.turn, "It is not your turn.");
  const st = copy(state), me = st.tokens[seat], foe = st.tokens[1 - seat];
  if (action?.type === "roll") {
    need(st.phase === "roll", "Move a token first.");
    const dice = 1 + Math.floor((ctx.rng ?? Math.random)() * 6); st.dice = dice; st.moves++;
    st.sixes = dice === 6 ? st.sixes + 1 : 0;
    if (st.sixes === 3) { note(st, `Seat ${seat} rolled a third 6 and loses the turn.`); st.last = { seat, dice, moved: null, pass: "three sixes" }; return pass(st, seat); }
    const can = movable(st, seat, dice);
    if (!can.length) { st.last = { seat, dice, moved: null, pass: "no move" }; return pass(st, seat); }
    st.phase = "move"; st.last = { seat, dice, moved: null };
    return { state: st, over: null };
  }
  if (action?.type === "move") {
    need(st.phase === "move" && st.dice != null, "Roll the dice first.");
    const i = Number(action.token); need(Number.isInteger(i) && i >= 0 && i < 4, "Pick one of your tokens.");
    need(movable(st, seat, st.dice).includes(i), me[i] === HOME ? "That token is already home." : me[i] === 0 ? "You need a 6 to bring a token out." : "That token needs a smaller number to get home.");
    const from = me[i], to = from === 0 ? 1 : from + st.dice; me[i] = to;
    let captured = [];
    const idx = trackIndex(seat, to);
    if (idx >= 0 && !SAFE.has(idx)) foe.forEach((p, j) => { if (p >= 1 && p <= 51 && trackIndex(1 - seat, p) === idx) { foe[j] = 0; captured.push(j); } });
    const dice = st.dice;
    st.last = { seat, dice, moved: i, from, to, captured };
    note(st, captured.length ? `Seat ${seat} captured ${captured.length} token${captured.length > 1 ? "s" : ""}.` : to === HOME ? `Seat ${seat} brought a token home.` : `Seat ${seat} moved ${dice}.`);
    if (me.every((p) => p === HOME)) { st.phase = "done"; st.dice = null; return { state: st, over: { winner: seat, reason: "All four tokens are home." } }; }
    if (dice === 6) { st.phase = "roll"; st.dice = null; return { state: st, over: null }; } // another roll (the third 6 was already stopped when it was rolled)
    return pass(st, seat);
  }
  throw new RuleError("Roll the dice or move a token.");
}

function pass(st, seat) { st.turn = 1 - seat; st.phase = "roll"; st.dice = null; st.sixes = 0; return { state: st, over: null }; }

export function view(state, seat) {
  const can = state.phase === "move" && seat === state.turn ? movable(state, seat, state.dice) : [];
  return { turn: state.turn, tokens: state.tokens, dice: state.dice, phase: state.phase, last: state.last, log: state.log, can, moves: state.moves };
}
