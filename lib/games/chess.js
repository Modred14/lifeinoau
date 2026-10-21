// lib/games/chess.js
// Chess, complete and server-side: every legal move (castling, en passant, promotion), check, checkmate, stalemate and the automatic draws
// (insufficient material, threefold repetition, fifty moves). Pure: no database, no browser, no clock.
//
// Squares are numbered 0..63 in reading order from White's side: 0 = a8, 7 = h8, 56 = a1, 63 = h1. The board is a 64 character string:
// uppercase = White, lowercase = Black, "." = empty. The match service owns seats; `white` and `turn` here are SEATS (0 or 1).
import { RuleError, need } from "./errors.js";

export const info = { id: "CHESS", name: "Chess", blurb: "The classic. Checkmate your opponent's king.", icon: "chess", turnSeconds: 180, seats: 2 };

const START = "rnbqkbnr" + "pppppppp" + "........".repeat(4) + "PPPPPPPP" + "RNBQKBNR";
const file = (s) => s & 7, rank = (s) => s >> 3; // rank 0 is the 8th rank
const sq = (f, r) => r * 8 + f;
const isW = (p) => p !== "." && p === p.toUpperCase();
const colorOf = (p) => (p === "." ? null : isW(p) ? "w" : "b");
const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]], KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Is square `s` attacked by any piece of colour `by`? */
export function attacked(b, s, by) {
  const f = file(s), r = rank(s), up = by === "w" ? 1 : -1; // a white pawn attacks towards smaller rank numbers, so it sits one rank BELOW (larger index) its target
  const pawn = by === "w" ? "P" : "p", knight = by === "w" ? "N" : "n", king = by === "w" ? "K" : "k";
  for (const df of [-1, 1]) { const ff = f + df, rr = r + up; if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8 && b[sq(ff, rr)] === pawn) return true; }
  for (const [df, dr] of KN) { const ff = f + df, rr = r + dr; if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8 && b[sq(ff, rr)] === knight) return true; }
  for (const [df, dr] of KG) { const ff = f + df, rr = r + dr; if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8 && b[sq(ff, rr)] === king) return true; }
  const slide = (dirs, kinds) => { for (const [df, dr] of dirs) { let ff = f + df, rr = r + dr; while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) { const p = b[sq(ff, rr)]; if (p !== ".") { if (colorOf(p) === by && kinds.includes(p.toLowerCase())) return true; break; } ff += df; rr += dr; } } return false; };
  return slide(DIAG, ["b", "q"]) || slide(ORTH, ["r", "q"]);
}
const kingOf = (b, c) => b.indexOf(c === "w" ? "K" : "k");
const inCheck = (b, c) => attacked(b, kingOf(b, c), c === "w" ? "b" : "w");

/** Pseudo-legal moves (they may leave the own king in check). { from, to, promo?, ep?, castle? } */
function pseudo(b, side, castle, ep) {
  const out = [], enemy = side === "w" ? "b" : "w";
  for (let s = 0; s < 64; s++) {
    const p = b[s]; if (p === "." || colorOf(p) !== side) continue;
    const f = file(s), r = rank(s), t = p.toLowerCase();
    if (t === "p") {
      const dir = side === "w" ? -1 : 1, start = side === "w" ? 6 : 1, last = side === "w" ? 0 : 7, r1 = r + dir;
      const add = (to, extra = {}) => { if (rank(to) === last) for (const pr of ["q", "r", "b", "n"]) out.push({ from: s, to, promo: pr, ...extra }); else out.push({ from: s, to, ...extra }); };
      if (r1 >= 0 && r1 < 8 && b[sq(f, r1)] === ".") { add(sq(f, r1)); if (r === start && b[sq(f, r + 2 * dir)] === ".") out.push({ from: s, to: sq(f, r + 2 * dir), double: true }); }
      for (const df of [-1, 1]) { const ff = f + df; if (ff < 0 || ff > 7 || r1 < 0 || r1 > 7) continue; const to = sq(ff, r1);
        if (b[to] !== "." && colorOf(b[to]) === enemy) add(to); else if (to === ep) out.push({ from: s, to, ep: true }); }
    } else if (t === "n" || t === "k") {
      for (const [df, dr] of t === "n" ? KN : KG) { const ff = f + df, rr = r + dr; if (ff < 0 || ff > 7 || rr < 0 || rr > 7) continue; const to = sq(ff, rr); if (colorOf(b[to]) !== side) out.push({ from: s, to }); }
      if (t === "k") { // castling: the king and rook have not moved, the squares between are empty, and the king does not start in, pass through or land in check
        const home = side === "w" ? 60 : 4, K = side === "w" ? "K" : "k", Q = side === "w" ? "Q" : "q", R = side === "w" ? "R" : "r";
        if (s === home && !attacked(b, home, enemy)) {
          if (castle.includes(K) && b[home + 1] === "." && b[home + 2] === "." && b[home + 3] === R && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy)) out.push({ from: s, to: home + 2, castle: "k" });
          if (castle.includes(Q) && b[home - 1] === "." && b[home - 2] === "." && b[home - 3] === "." && b[home - 4] === R && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy)) out.push({ from: s, to: home - 2, castle: "q" });
        }
      }
    } else {
      const dirs = t === "b" ? DIAG : t === "r" ? ORTH : KG;
      for (const [df, dr] of dirs) { let ff = f + df, rr = r + dr; while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) { const to = sq(ff, rr), q = b[to]; if (q === ".") out.push({ from: s, to }); else { if (colorOf(q) !== side) out.push({ from: s, to }); break; } ff += df; rr += dr; } }
    }
  }
  return out;
}

/** The board after a move (the move is assumed pseudo-legal). Returns { b, captured }. */
function make(b, m) {
  const a = b.split(""), p = a[m.from]; let captured = a[m.to];
  a[m.to] = m.promo ? (isW(p) ? m.promo.toUpperCase() : m.promo) : p; a[m.from] = ".";
  if (m.ep) { const cs = sq(file(m.to), rank(m.from)); captured = a[cs]; a[cs] = "."; }
  if (m.castle) { const home = rank(m.from) * 8, rook = a[home + (m.castle === "k" ? 7 : 0)]; a[home + (m.castle === "k" ? 7 : 0)] = "."; a[home + (m.castle === "k" ? 5 : 3)] = rook; }
  return { b: a.join(""), captured };
}

/** Castling rights after a move or capture touches a corner or a king. */
function rights(castle, m, p) {
  let c = castle;
  const strip = (chars) => { for (const ch of chars) c = c.replace(ch, ""); };
  if (p === "K") strip("KQ"); if (p === "k") strip("kq");
  for (const s of [m.from, m.to]) { if (s === 63) strip("K"); if (s === 56) strip("Q"); if (s === 7) strip("k"); if (s === 0) strip("q"); }
  return c;
}

/** Every legal move for `side` in a position: { b, side, castle, ep }. */
export function legalMoves(pos) {
  const { b, side, castle, ep } = pos;
  return pseudo(b, side, castle, ep).filter((m) => !inCheck(make(b, m).b, side));
}

const name = (s) => "abcdefgh"[file(s)] + (8 - rank(s));
const parseSq = (n) => (typeof n === "string" && /^[a-h][1-8]$/.test(n) ? sq(n.charCodeAt(0) - 97, 8 - Number(n[1])) : -1);

/** Standard algebraic notation for a legal move in `pos` (check marks are added by the caller). */
function san(pos, m, legal) {
  const p = pos.b[m.from], t = p.toLowerCase();
  if (m.castle) return m.castle === "k" ? "O-O" : "O-O-O";
  const cap = pos.b[m.to] !== "." || m.ep;
  if (t === "p") return (cap ? "abcdefgh"[file(m.from)] + "x" : "") + name(m.to) + (m.promo ? "=" + m.promo.toUpperCase() : "");
  const rivals = legal.filter((o) => o !== m && pos.b[o.from] === p && o.to === m.to);
  let dis = ""; if (rivals.length) { dis = rivals.some((o) => file(o.from) === file(m.from)) ? (rivals.some((o) => rank(o.from) === rank(m.from)) ? name(m.from) : String(8 - rank(m.from))) : "abcdefgh"[file(m.from)]; }
  return t.toUpperCase() + dis + (cap ? "x" : "") + name(m.to);
}

const key = (pos) => {
  // two positions are the same for repetition when pieces, side, castling rights and (only if it can really be taken) the en passant square match
  const epOk = pos.ep >= 0 && pseudo(pos.b, pos.side, pos.castle, pos.ep).some((m) => m.ep && !inCheck(make(pos.b, m).b, pos.side));
  return pos.b + pos.side + pos.castle + (epOk ? pos.ep : "-");
};

/** Not enough material for either side to ever deliver mate. */
export function insufficient(b) {
  const rest = b.split("").filter((c) => c !== "." && c.toLowerCase() !== "k");
  if (!rest.length) return true;
  if (rest.every((c) => "nbNB".includes(c))) {
    if (rest.length === 1) return true;
    const bishops = rest.filter((c) => c.toLowerCase() === "b"); // only bishops, all on one colour of square: nobody can mate
    if (bishops.length === rest.length) { const col = new Set(); b.split("").forEach((c, s) => { if (c.toLowerCase() === "b") col.add((file(s) + rank(s)) & 1); }); return col.size === 1; }
  }
  return false;
}

const FILL = (pos) => ({ b: pos.b, side: pos.side, castle: pos.castle, ep: pos.ep });
const posOf = (st) => ({ b: st.board, side: st.side, castle: st.castle, ep: st.ep });

/** A new game. White is one seat chosen at random. */
export function create(rng) {
  const white = rng() < 0.5 ? 0 : 1;
  const st = { white, turn: white, board: START, side: "w", castle: "KQkq", ep: -1, half: 0, full: 1, moves: [], last: null, check: false, taken: { w: [], b: [] }, seen: {} };
  st.seen[key(posOf(st))] = 1;
  return st;
}
export const turnOf = (st) => st.turn;

/** Where the piece on `from` may go (for a screen to highlight), as square names. */
export function targetsFrom(st, from) {
  const f = parseSq(from); if (f < 0) return [];
  return [...new Set(legalMoves(posOf(st)).filter((m) => m.from === f).map((m) => name(m.to)))];
}

/** One move: { type: "move", from: "e2", to: "e4", promo?: "q" }. Returns { state, over }. */
export function act(state, seat, action) {
  need(action?.type === "move", "Make a move.");
  need(seat === state.turn, "It is not your turn.");
  const from = parseSq(action.from), to = parseSq(action.to); need(from >= 0 && to >= 0, "That square does not exist.");
  const pos = posOf(state), legal = legalMoves(pos);
  const cands = legal.filter((m) => m.from === from && m.to === to);
  if (!cands.length) throw new RuleError(state.board[from] === "." || colorOf(state.board[from]) !== state.side ? "Move one of your own pieces." : state.check ? "Your king is in check. Get out of check." : "That move is not legal.");
  let m = cands[0];
  if (cands.length > 1) { const want = String(action.promo ?? "q").toLowerCase(); m = cands.find((c) => c.promo === want); need(m, "Choose queen, rook, bishop or knight to promote to."); }
  const side = state.side, enemy = side === "w" ? "b" : "w", p = state.board[from];
  const { b, captured } = make(state.board, m), after = { b, side: enemy, castle: rights(state.castle, m, p), ep: m.double ? sq(file(from), (rank(from) + rank(to)) / 2) : -1 };
  const next = legalMoves(after), check = inCheck(b, enemy);
  let text = san(pos, m, legal) + (check ? (next.length ? "+" : "#") : "");
  const st = { ...state, board: b, side: enemy, castle: after.castle, ep: after.ep, turn: 1 - state.turn, half: (p.toLowerCase() === "p" || captured !== ".") ? 0 : state.half + 1, full: state.full + (side === "b" ? 1 : 0),
    moves: [...state.moves, text], last: { from: name(from), to: name(to) }, check, taken: { w: [...state.taken.w], b: [...state.taken.b] }, seen: { ...state.seen } };
  if (captured !== ".") st.taken[side].push(captured.toLowerCase()); // what `side` has taken, kept as lowercase letters
  const k = key(posOf(st)); st.seen[k] = (st.seen[k] ?? 0) + 1;
  let over = null;
  const who = (c) => (c === "w" ? state.white : 1 - state.white);
  if (!next.length) over = check ? { winner: who(side), reason: "Checkmate." } : { winner: null, reason: "Stalemate: the player to move has no legal move." };
  else if (insufficient(b)) over = { winner: null, reason: "Draw: neither side has enough pieces to checkmate." };
  else if (st.seen[k] >= 3) over = { winner: null, reason: "Draw by threefold repetition." };
  else if (st.half >= 100) over = { winner: null, reason: "Draw by the fifty-move rule." };
  return { state: st, over };
}

/** What a screen needs: the board, whose turn, legal targets for the player to move, the move list and the last move. */
export function view(state, seat) {
  const mine = seat === state.turn ? Object.fromEntries([...new Set(legalMoves(posOf(state)).map((m) => name(m.from)))].map((f) => [f, targetsFrom(state, f)])) : {};
  return { white: state.white, turn: state.turn, board: state.board, check: state.check, last: state.last, moves: state.moves, taken: state.taken, half: state.half, legal: mine, full: state.full };
}

/** Test and tooling helpers. */
export const _t = { START, legalMoves, make, attacked, inCheck, fromFen, name, parseSq, FILL };
/** A position from a FEN string (only the first four fields matter): { b, side, castle, ep }. */
export function fromFen(fen) {
  const [pl, side = "w", castle = "-", ep = "-"] = fen.trim().split(/\s+/);
  const rows = pl.split("/").map((r) => r.replace(/\d/g, (d) => ".".repeat(Number(d)))); if (rows.length !== 8 || rows.some((r) => r.length !== 8)) throw new Error("bad FEN");
  return { b: rows.join(""), side, castle: castle === "-" ? "" : castle, ep: ep === "-" ? -1 : parseSq(ep) };
}
export function perft(pos, depth) {
  if (!depth) return 1; let n = 0;
  for (const m of legalMoves(pos)) { const { b } = make(pos.b, m), p = pos.b[m.from]; n += perft({ b, side: pos.side === "w" ? "b" : "w", castle: rights(pos.castle, m, p), ep: m.double ? sq(file(m.from), (rank(m.from) + rank(m.to)) / 2) : -1 }, depth - 1); }
  return n;
}
