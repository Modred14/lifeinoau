// lib/games/checkers.js
// Checkers (English draughts) on the 8 by 8 board: men move one square diagonally forward, kings both ways, a capture is compulsory, you may keep jumping
// with the same piece, and a man that reaches the far row becomes a king (and the turn ends). You win when your rival has no piece or no legal move.
// A draw comes after 40 moves each with no capture and no man moved, or by agreement. Seat 0 plays from the bottom of the board, seat 1 from the top.
import { need } from "./errors.js";

export const info = { id: "CHECKERS", name: "Checkers", blurb: "Jump your rival's pieces. Captures are compulsory.", icon: "checkers", turnSeconds: 60, seats: 2 };
export const IDLE_LIMIT = 80; // plies without a capture or a man moving

// piece codes: 0 empty, 1 seat 0 man, 2 seat 0 king, 3 seat 1 man, 4 seat 1 king. Index = row * 8 + column, row 0 at the top. Dark squares have (row + column) odd.
const owner = (p) => (p === 0 ? -1 : p <= 2 ? 0 : 1), isKing = (p) => p === 2 || p === 4;

export function create(rng) {
  const b = new Array(64).fill(0);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) { if (r < 3) b[r * 8 + c] = 3; else if (r > 4) b[r * 8 + c] = 1; }
  return { turn: rng() < 0.5 ? 0 : 1, board: b, idle: 0, last: null, plies: 0 };
}
export const turnOf = (st) => st.turn;

/** Every legal move for `seat`: [{ path: [from, ..., to], caps: [captured squares] }]. If any capture exists, only captures are returned. */
export function legalMoves(board, seat) {
  const caps = [], steps = [];
  const dirs = (p) => (isKing(p) ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : seat === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
  const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  for (let s = 0; s < 64; s++) {
    const p = board[s]; if (owner(p) !== seat) continue;
    const r0 = Math.floor(s / 8), c0 = s % 8;
    for (const [dr, dc] of dirs(p)) { const r = r0 + dr, c = c0 + dc; if (inB(r, c) && board[r * 8 + c] === 0) steps.push({ path: [s, r * 8 + c], caps: [] }); }
    const walk = (cur, r, c, king, path, taken) => {
      let any = false;
      for (const [dr, dc] of king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : dirs(p)) {
        const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc; if (!inB(lr, lc)) continue;
        const mid = mr * 8 + mc, land = lr * 8 + lc, q = board[mid];
        if (owner(q) !== 1 - seat || taken.includes(mid)) continue;
        if (board[land] !== 0 && land !== s) continue; // the square it left counts as empty while jumping
        any = true;
        const becomes = !king && lr === (seat === 0 ? 0 : 7); // a man that reaches the far row is crowned and stops
        const np = [...path, land], nt = [...taken, mid];
        if (becomes) caps.push({ path: np, caps: nt }); else walk(land, lr, lc, king, np, nt);
      }
      if (!any && taken.length) caps.push({ path, caps: taken });
    };
    walk(s, r0, c0, isKing(p), [s], []);
  }
  return caps.length ? caps : steps;
}

/** { type: "move", path: [from, ..., to] } (square indexes). */
export function act(state, seat, action) {
  need(action?.type === "move" && Array.isArray(action.path), "Make a move.");
  need(seat === state.turn, "It is not your turn.");
  const path = action.path.map(Number); need(path.length >= 2 && path.every((n) => Number.isInteger(n) && n >= 0 && n < 64), "That move could not be read.");
  const legal = legalMoves(state.board, seat), mv = legal.find((m) => m.path.length === path.length && m.path.every((n, i) => n === path[i]));
  if (!mv) { const mustJump = legal.some((m) => m.caps.length); need(false, mustJump ? "You must jump when you can." : "That move is not legal."); }
  const b = [...state.board], from = path[0], to = path[path.length - 1], piece = b[from];
  b[from] = 0; for (const c of mv.caps) b[c] = 0;
  const crown = (piece === 1 && Math.floor(to / 8) === 0) || (piece === 3 && Math.floor(to / 8) === 7);
  b[to] = crown ? piece + 1 : piece;
  const idle = mv.caps.length || !isKing(piece) ? 0 : state.idle + 1, st = { ...state, board: b, turn: 1 - seat, idle, plies: state.plies + 1, last: { path, caps: mv.caps, crowned: crown } };
  if (!b.some((p) => owner(p) === 1 - seat)) return { state: st, over: { winner: seat, reason: "Every opposing piece was captured." } };
  if (!legalMoves(b, 1 - seat).length) return { state: st, over: { winner: seat, reason: "Your rival has no legal move." } };
  if (idle >= IDLE_LIMIT) return { state: st, over: { winner: null, reason: "Draw: 40 moves each without a capture or a man moving." } };
  return { state: st, over: null };
}

export function view(state, seat) {
  const legal = seat === state.turn ? legalMoves(state.board, seat).map((m) => ({ path: m.path, caps: m.caps })) : [];
  return { turn: state.turn, board: state.board, last: state.last, legal, idle: state.idle, plies: state.plies };
}
