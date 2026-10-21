// lib/games/tictactoe.js
// Tic-Tac-Toe as a short match: best of three rounds (a drawn round is replayed, up to five rounds in all). Seat 0 is X, seat 1 is O; the player who
// starts alternates each round.
import { need } from "./errors.js";

export const info = { id: "TICTACTOE", name: "Tic-Tac-Toe", blurb: "Best of three rounds. Quick, tense, and harder than it looks.", icon: "tictactoe", turnSeconds: 30, seats: 2 };
export const WIN_ROUNDS = 2, MAX_ROUNDS = 5;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export function create(rng) {
  const start = rng() < 0.5 ? 0 : 1;
  return { turn: start, start, round: 1, wins: [0, 0], board: new Array(9).fill(0), last: null, line: null, rounds: [] }; // board: 0 empty, 1 = seat 0 (X), 2 = seat 1 (O)
}
export const turnOf = (st) => st.turn;

/** { type: "mark", cell: 0..8 } */
export function act(state, seat, action) {
  need(action?.type === "mark", "Pick a square.");
  need(seat === state.turn, "It is not your turn.");
  const i = Number(action.cell); need(Number.isInteger(i) && i >= 0 && i < 9, "Pick a square.");
  need(state.board[i] === 0, "That square is taken.");
  const b = [...state.board]; b[i] = seat + 1;
  const st = { ...state, board: b, last: i, wins: [...state.wins], rounds: [...state.rounds], line: null }, line = LINES.find((l) => l.every((c) => b[c] === seat + 1));
  if (!line && b.some((c) => c === 0)) { st.turn = 1 - seat; return { state: st, over: null }; }
  // the round is over
  st.rounds.push({ round: state.round, winner: line ? seat : null, line: line ?? null });
  if (line) st.wins[seat]++;
  if (st.wins[seat] >= WIN_ROUNDS) return { state: { ...st, line }, over: { winner: seat, reason: `Won ${st.wins[0]} to ${st.wins[1]}.` } };
  if (st.round >= MAX_ROUNDS) return { state: { ...st, line }, over: st.wins[0] === st.wins[1] ? { winner: null, reason: "Still level after five rounds." } : { winner: st.wins[0] > st.wins[1] ? 0 : 1, reason: `Won ${st.wins[0]} to ${st.wins[1]}.` } };
  const start = 1 - state.start; // next round: the other player opens
  return { state: { ...st, round: state.round + 1, start, turn: start, board: new Array(9).fill(0), line: null, last: null, prev: { board: b, line, winner: line ? seat : null } }, over: null };
}
export const view = (state) => ({ turn: state.turn, board: state.board, last: state.last, line: state.line, round: state.round, wins: state.wins, rounds: state.rounds, prev: state.prev ?? null, start: state.start });
