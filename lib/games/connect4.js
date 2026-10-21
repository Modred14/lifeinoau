// lib/games/connect4.js
// Connect Four: drop discs into a 7 by 6 grid; the first to line up four (across, down or diagonally) wins. A full board is a draw.
import { need } from "./errors.js";

export const info = { id: "CONNECT4", name: "Connect Four", blurb: "Drop discs and line up four before your rival does.", icon: "connect4", turnSeconds: 45, seats: 2 };
export const COLS = 7, ROWS = 6;

export function create(rng) {
  const turn = rng() < 0.5 ? 0 : 1;
  return { turn, board: new Array(COLS * ROWS).fill(0), moves: 0, last: null, line: null }; // 0 empty, 1 = seat 0, 2 = seat 1; index = row * 7 + column, row 0 on top
}
export const turnOf = (st) => st.turn;

/** The four cells that make a line through `i` for disc `d`, or null. */
function lineThrough(b, i, d) {
  const r = Math.floor(i / COLS), c = i % COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [i];
    for (const s of [1, -1]) { let rr = r + dr * s, cc = c + dc * s; while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === d) { cells.push(rr * COLS + cc); rr += dr * s; cc += dc * s; } }
    if (cells.length >= 4) return cells.slice(0, 4);
  }
  return null;
}

/** { type: "drop", col: 0..6 } */
export function act(state, seat, action) {
  need(action?.type === "drop", "Drop a disc.");
  need(seat === state.turn, "It is not your turn.");
  const c = Number(action.col); need(Number.isInteger(c) && c >= 0 && c < COLS, "Pick a column.");
  const b = [...state.board]; let row = -1; for (let r = ROWS - 1; r >= 0; r--) if (b[r * COLS + c] === 0) { row = r; break; }
  need(row >= 0, "That column is full.");
  const i = row * COLS + c, d = seat + 1; b[i] = d;
  const st = { ...state, board: b, moves: state.moves + 1, last: i, turn: 1 - seat }, line = lineThrough(b, i, d);
  if (line) return { state: { ...st, line }, over: { winner: seat, reason: "Four in a row." } };
  if (st.moves === COLS * ROWS) return { state: st, over: { winner: null, reason: "The board is full." } };
  return { state: st, over: null };
}
export const view = (state) => ({ turn: state.turn, board: state.board, last: state.last, line: state.line, moves: state.moves, cols: COLS, rows: ROWS });
