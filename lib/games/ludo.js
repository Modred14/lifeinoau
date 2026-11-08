// lib/games/ludo.js
// Ludo for two players, decided entirely on the server: the dice are rolled here (never by the browser), only legal moves are accepted, and the
// screen is given the same geometry (TRACK, HOME_COLUMN, ...) so it draws exactly what the rules use.
//
// Rules: every roll is TWO dice. Each die is a separate move: it moves one token (any of your tokens) by that die's number, and the two dice can be used in either order and on the same
// token or on different ones. Roll a 6 on a die to bring a token out of the yard with it. A token walks 51 squares round the board and then up its own home column; it needs the exact
// number to reach home. Landing on a lone opponent token sends it back to the yard, except on a safe square (the start squares and the stars). A die that has no legal move is lost
// (and when neither die can move, the turn passes). Rolling a double (the same number on both dice) gives another roll once both dice are used, but a third double in a row loses the turn.
// First to bring all four tokens home wins.
import { RuleError, need } from "./errors.js";

export const info = { id: "LUDO", name: "Ludo", blurb: "Roll two dice, race and capture. First to bring all four tokens home wins.", icon: "dice", turnSeconds: 90, seats: 2 };

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
  return { turn, tokens: [[0, 0, 0, 0], [0, 0, 0, 0]], dice: null, left: [], doubles: 0, phase: "roll", last: null, moves: 0 };
}
export const turnOf = (st) => st.turn;

/** A match started before the second die existed keeps working: its one number becomes a one-die roll. */
function norm(st) {
  if (Array.isArray(st.left) && (st.dice === null || Array.isArray(st.dice))) return st;
  const d = typeof st.dice === "number" ? st.dice : null;
  return { ...st, dice: d == null ? null : [d], left: d == null ? [] : [d], doubles: st.doubles ?? 0 };
}

/** Which tokens of `seat` can move by one die value `die`. */
export function movable(st, seat, die) {
  const out = [];
  st.tokens[seat].forEach((p, i) => {
    if (p === HOME) return;
    if (p === 0) { if (die === 6) out.push(i); return; }
    if (p + die <= HOME) out.push(i);
  });
  return out;
}
/** Every legal move right now as { token, die } (each distinct die value once per token). */
export function legalMoves(state, seat) {
  const st = norm(state), out = [];
  if (st.phase !== "move") return out;
  for (const die of new Set(st.left)) for (const token of movable(st, seat, die)) out.push({ token, die });
  return out;
}

const copy = (st) => ({ ...st, tokens: st.tokens.map((t) => [...t]), left: [...st.left], dice: st.dice && [...st.dice] });

/** { type: "roll" } or { type: "move", token: 0..3, die: 1..6 } (`die` may be left out when only one die is still to play). `ctx.rng()` gives the dice. */
export function act(state, seat, action, ctx = {}) {
  need(seat === state.turn, "It is not your turn.");
  const st = copy(norm(state)), me = st.tokens[seat], foe = st.tokens[1 - seat];
  if (action?.type === "roll") {
    need(st.phase === "roll", "Move a token first.");
    const rng = ctx.rng ?? Math.random, a = 1 + Math.floor(rng() * 6), b = 1 + Math.floor(rng() * 6);
    st.dice = [a, b]; st.left = [a, b]; st.moves++;
    st.doubles = a === b ? (st.doubles ?? 0) + 1 : 0;
    if (st.doubles === 3) { st.last = { seat, dice: [a, b], moved: null, pass: "three doubles" }; return pass(st, seat); }
    st.phase = "move";
    if (!legalMoves(st, seat).length) { st.phase = "roll"; st.last = { seat, dice: [a, b], moved: null, pass: "no move" }; return pass(st, seat); }
    st.last = { seat, dice: [a, b], moved: null };
    return { state: st, over: null };
  }
  if (action?.type === "move") {
    need(st.phase === "move" && st.dice != null, "Roll the dice first.");
    const i = Number(action.token); need(Number.isInteger(i) && i >= 0 && i < 4, "Pick one of your tokens.");
    const die = action.die == null && st.left.length === 1 ? st.left[0] : Number(action.die);
    need(Number.isInteger(die) && st.left.includes(die), "Pick one of the dice you still have to play.");
    need(movable(st, seat, die).includes(i), me[i] === HOME ? "That token is already home." : me[i] === 0 ? "You need a 6 to bring a token out." : "That token needs a smaller number to get home.");
    const from = me[i], to = from === 0 ? 1 : from + die; me[i] = to;
    st.left.splice(st.left.indexOf(die), 1);
    const captured = [], idx = trackIndex(seat, to);
    if (idx >= 0 && !SAFE.has(idx)) foe.forEach((p, j) => { if (p >= 1 && p <= 51 && trackIndex(1 - seat, p) === idx) { foe[j] = 0; captured.push(j); } });
    st.last = { seat, dice: st.dice, die, moved: i, from, to, captured };
    if (me.every((p) => p === HOME)) { st.phase = "done"; st.dice = null; st.left = []; return { state: st, over: { winner: seat, reason: "All four tokens are home." } }; }
    if (st.left.length && legalMoves(st, seat).length) return { state: st, over: null }; // the other die is still to play
    st.left = [];                                                                         // (a die nobody can play is lost)
    if (st.dice[0] === st.dice[1]) { st.phase = "roll"; st.dice = null; return { state: st, over: null }; } // a double: roll again (the third double was already stopped when it was rolled)
    return pass(st, seat);
  }
  throw new RuleError("Roll the dice or move a token.");
}

function pass(st, seat) { st.turn = 1 - seat; st.phase = "roll"; st.dice = null; st.left = []; st.doubles = 0; return { state: st, over: null }; }

export function view(state, seat) {
  const st = norm(state), mineToMove = st.phase === "move" && seat === st.turn;
  const options = mineToMove ? [...new Set(st.left)].map((die) => ({ die, tokens: movable(st, seat, die) })).filter((o) => o.tokens.length) : [];
  const rest = st.dice ? [...st.left] : []; // which of the two dice are already played (so the screen can dim them): a value still in `left` is unplayed
  const used = st.dice ? st.dice.map((v) => { const k = rest.indexOf(v); if (k >= 0) { rest.splice(k, 1); return false; } return true; }) : [];
  return { turn: st.turn, tokens: st.tokens, dice: st.dice, used, phase: st.phase, last: st.last, can: [...new Set(options.flatMap((o) => o.tokens))], options, moves: st.moves };
}
