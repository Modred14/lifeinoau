// lib/games/ai.js
// The AI opponents. Pure: no database, no browser, no clock of its own (every function is given the position and a seed), so the server, the tests and
// any future tool get the same player. The match service (lib/games/matchService.js) decides WHEN the AI moves; this file decides WHAT it moves and how
// long a person would have taken to do it.
//
// What keeps it honest and natural:
//  * It only ever plays what the game's own engine accepts (it is built from the engines' own rule helpers, and the tests play whole games through act()).
//  * It sees what a player sees: the board, its own hand / dice / meter. It never reads the rival's hidden cards, and it cannot see the dice before they are rolled.
//  * It is not perfect. Each persona has a skill (0..1): weaker ones search less deep, take a near-best move instead of the best one now and then, and miss
//    shots by a believable amount. It never plays a random blunder where the game punishes one instantly (chess and checkers only choose among sound moves).
//  * It takes time, like a person: a think time per move that depends on the game, how many choices there are (a forced move is quick) and the persona's tempo.
import * as chess from "./chess.js";
import * as checkers from "./checkers.js";
import * as ludo from "./ludo.js";
import * as hoops from "./hoops.js";
import * as pool from "./pool.js";
import * as whot from "./whot.js";
import * as tictactoe from "./tictactoe.js";
import * as connect4 from "./connect4.js";

// ------------------------------------------------------------------------------------------------ who the AI players are
export const BOT_PREFIX = "bot:";
export const isBotId = (id) => typeof id === "string" && id.startsWith(BOT_PREFIX);
/** The roster. `skill` 0..1 (how well it plays), `tempo` (how fast it moves: 1 is average). Every name ends in "(AI)": nobody is ever told they are playing a person. */
export const BOT_ROSTER = [
  { key: "tunde", name: "Tunde (AI)", level: 200, skill: 0.62, tempo: 1.0 },
  { key: "amaka", name: "Amaka (AI)", level: 300, skill: 0.72, tempo: 0.9 },
  { key: "seun", name: "Seun (AI)", level: 100, skill: 0.52, tempo: 1.15 },
  { key: "chiamaka", name: "Chiamaka (AI)", level: 400, skill: 0.8, tempo: 1.05 },
  { key: "ibrahim", name: "Ibrahim (AI)", level: 200, skill: 0.66, tempo: 0.85 },
  { key: "folake", name: "Folake (AI)", level: 100, skill: 0.48, tempo: 1.2 },
  { key: "emeka", name: "Emeka (AI)", level: 500, skill: 0.84, tempo: 0.95 },
  { key: "zainab", name: "Zainab (AI)", level: 300, skill: 0.6, tempo: 1.1 },
  { key: "kelechi", name: "Kelechi (AI)", level: 400, skill: 0.74, tempo: 0.8 },
  { key: "bisi", name: "Bisi (AI)", level: 100, skill: 0.45, tempo: 1.25 },
  { key: "obinna", name: "Obinna (AI)", level: 500, skill: 0.78, tempo: 1.0 },
  { key: "hauwa", name: "Hauwa (AI)", level: 200, skill: 0.57, tempo: 1.05 },
];
export const botId = (key) => BOT_PREFIX + key;
/** The persona behind an id (an unknown id gets a middling stand-in so an old row can never crash a screen). */
export const botById = (id) => BOT_ROSTER.find((b) => botId(b.key) === id) ?? { key: String(id).slice(BOT_PREFIX.length) || "ai", name: "AI opponent (AI)", level: 200, skill: 0.6, tempo: 1 };
export const botName = (id) => botById(id).name;
/** A persona for a new match: random, but not the one the player just faced. */
export function pickBot(rng, avoidId = null) {
  const pool_ = BOT_ROSTER.filter((b) => botId(b.key) !== avoidId);
  return pool_[Math.floor(rng() * pool_.length)];
}

// ------------------------------------------------------------------------------------------------ seeded randomness (so a move and its delay are the same every time they are worked out)
export function hashSeed(...parts) {
  let h = 2166136261;
  for (const ch of parts.join("|")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (rng) => { let u = 0; for (let i = 0; i < 6; i++) u += rng(); return (u - 3) / Math.SQRT1_2 / 1.2247; }; // ~N(0,1), cheap
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pickOne = (list, rng) => list[Math.floor(rng() * list.length)];

/** Chooses from moves scored `{ move, score }`: usually the best, sometimes a near-best one (a slip), and only at low skill a random one if `blunder` allows. */
function choose(scored, skill, rng, { margin = 0, slip = 0, blunder = 0 } = {}) {
  const sorted = [...scored].sort((a, b) => b.score - a.score), best = sorted[0];
  if (!best) return null;
  if (blunder && rng() < (1 - skill) * blunder) return pickOne(sorted, rng).move;
  if (slip && margin && sorted.length > 1 && rng() < (1 - skill) * slip) {
    const near = sorted.slice(1).filter((s) => s.score >= best.score - margin);
    if (near.length) return pickOne(near, rng).move;
  }
  const ties = sorted.filter((s) => s.score === best.score);
  return pickOne(ties, rng).move;
}

// ================================================================================================ TIC-TAC-TOE
const T3_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const t3Winner = (b) => { for (const [x, y, z] of T3_LINES) if (b[x] && b[x] === b[y] && b[y] === b[z]) return b[x]; return 0; };
function t3Value(b, mark, me, depth) { // minimax from `me`'s point of view: quicker wins and slower losses score higher
  const w = t3Winner(b); if (w) return w === me ? 10 - depth : depth - 10;
  if (!b.includes(0)) return 0;
  let best = mark === me ? -99 : 99;
  for (let i = 0; i < 9; i++) if (b[i] === 0) { b[i] = mark; const v = t3Value(b, 3 - mark, me, depth + 1); b[i] = 0; best = mark === me ? Math.max(best, v) : Math.min(best, v); }
  return best;
}
function t3Choose(state, seat, rng, skill) {
  const b = [...state.board], me = seat + 1, scored = [];
  for (let i = 0; i < 9; i++) if (b[i] === 0) { b[i] = me; scored.push({ move: { type: "mark", cell: i }, score: t3Value(b, 3 - me, me, 1) }); b[i] = 0; }
  const best = Math.max(...scored.map((s) => s.score));
  // a slip: from a winning position settling for a draw; the odd careless move at low skill (never from a position that is only a draw: that would just lose)
  const sure = best >= 9; // a win this very move is always taken: nobody passes that up
  return choose(scored, skill, rng, { margin: !sure && best > 0 ? best : 0, slip: 0.7, blunder: !sure && best > 0 ? 0.05 : 0 });
}

// ================================================================================================ CONNECT FOUR
const C4_COLS = connect4.COLS, C4_ROWS = connect4.ROWS, C4_ORDER = [3, 2, 4, 1, 5, 0, 6];
const c4Open = (b) => C4_ORDER.filter((c) => b[c] === 0); // the top row is row 0
function c4Drop(b, col, d) { for (let r = C4_ROWS - 1; r >= 0; r--) if (b[r * C4_COLS + col] === 0) { b[r * C4_COLS + col] = d; return r * C4_COLS + col; } return -1; }
function c4Wins(b, i, d) {
  const r = Math.floor(i / C4_COLS), c = i % C4_COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1;
    for (const s of [1, -1]) { let rr = r + dr * s, cc = c + dc * s; while (rr >= 0 && rr < C4_ROWS && cc >= 0 && cc < C4_COLS && b[rr * C4_COLS + cc] === d) { n++; rr += dr * s; cc += dc * s; } }
    if (n >= 4) return true;
  }
  return false;
}
const C4_WINDOWS = (() => { const w = []; for (let r = 0; r < C4_ROWS; r++) for (let c = 0; c < C4_COLS; c++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) { const cells = []; for (let k = 0; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= C4_ROWS || cc < 0 || cc >= C4_COLS) break; cells.push(rr * C4_COLS + cc); } if (cells.length === 4) w.push(cells); } return w; })();
function c4Eval(b, d) { // from disc d's point of view
  let s = 0; const o = 3 - d;
  for (let r = 0; r < C4_ROWS; r++) { const v = b[r * C4_COLS + 3]; if (v === d) s += 3; else if (v === o) s -= 3; }
  for (const w of C4_WINDOWS) {
    let mine = 0, theirs = 0; for (const i of w) { if (b[i] === d) mine++; else if (b[i] === o) theirs++; }
    if (mine && theirs) continue;
    if (mine === 3) s += 6; else if (mine === 2) s += 2; if (theirs === 3) s -= 7; else if (theirs === 2) s -= 2;
  }
  return s;
}
function c4Search(b, d, depth, alpha, beta, last, ply) { // negamax: the score for disc `d`, who is to move; `last` is the cell the rival just filled
  const o = 3 - d;
  if (last >= 0 && c4Wins(b, last, o)) return -100000 + ply;
  const cols = c4Open(b); if (!cols.length) return 0;
  if (depth === 0) return c4Eval(b, d);
  let best = -Infinity;
  for (const c of cols) {
    const i = c4Drop(b, c, d), v = -c4Search(b, o, depth - 1, -beta, -alpha, i, ply + 1); b[i] = 0;
    if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break;
  }
  return best;
}
function c4Choose(state, seat, rng, skill) {
  const b = [...state.board], d = seat + 1, depth = 3 + Math.round(skill * 3), scored = [];
  for (const c of c4Open(b)) { const i = c4Drop(b, c, d); scored.push({ move: { type: "drop", col: c }, score: c4Wins(b, i, d) ? 100000 : -c4Search(b, 3 - d, depth - 1, -Infinity, Infinity, i, 1) + (rng() - 0.5) * 0.2 }); b[i] = 0; }
  const best = Math.max(...scored.map((s) => s.score));
  return choose(scored, skill, rng, { margin: best >= 50000 ? 0 : 6, slip: 0.4, blunder: best >= 50000 ? 0 : 0.05 });
}

// ================================================================================================ CHECKERS
const ownerOf = (p) => (p === 0 ? -1 : p <= 2 ? 0 : 1), kingP = (p) => p === 2 || p === 4;
function ckApply(board, mv) {
  const b = board.slice(), from = mv.path[0], to = mv.path[mv.path.length - 1], p = b[from];
  b[from] = 0; for (const c of mv.caps) b[c] = 0;
  b[to] = (p === 1 && to >> 3 === 0) || (p === 3 && to >> 3 === 7) ? p + 1 : p;
  return b;
}
function ckEval(b, seat) { // material, advancement and a little for holding the centre, from `seat`'s point of view
  let s = 0;
  for (let i = 0; i < 64; i++) { const p = b[i]; if (!p) continue; const o = ownerOf(p), r = i >> 3, c = i & 7, sign = o === seat ? 1 : -1;
    let v = kingP(p) ? 175 : 100 + (o === 0 ? 7 - r : r) * 4;
    if (!kingP(p) && ((o === 0 && r === 7) || (o === 1 && r === 0))) v += 6; // a back-row man guards the crowning squares
    if (c >= 2 && c <= 5 && r >= 2 && r <= 5) v += 3;
    s += sign * v; }
  return s;
}
function ckSearch(b, turn, depth, alpha, beta, me, ply, maxPly) {
  const moves = checkers.legalMoves(b, turn);
  if (!moves.length) return turn === me ? -10000 + ply : 10000 - ply;
  if (depth <= 0 && !(moves[0].caps.length && ply < maxPly)) return ckEval(b, me); // a jump still waiting is played out before the position is judged
  let best = turn === me ? -Infinity : Infinity;
  for (const mv of moves) {
    const v = ckSearch(ckApply(b, mv), 1 - turn, depth - 1, alpha, beta, me, ply + 1, maxPly);
    if (turn === me) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}
function ckChoose(state, seat, rng, skill) {
  const moves = checkers.legalMoves(state.board, seat), depth = 3 + Math.round(skill * 3);
  const scored = moves.map((mv) => ({ move: { type: "move", path: mv.path }, score: ckSearch(ckApply(state.board, mv), 1 - seat, depth - 1, -Infinity, Infinity, seat, 1, depth + 4) + rng() * 0.5 }));
  const best = Math.max(...scored.map((s) => s.score));
  return choose(scored, skill, rng, { margin: best > 5000 ? 0 : 30 + (1 - skill) * 60, slip: 0.35 });
}

// ================================================================================================ CHESS
const { legalMoves: chessMoves, make: chessMake, inCheck: chessInCheck, name: sqName } = chess._t;
const CV = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 }, MATE = 100000;
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const cDist = (s) => { const f = s & 7, r = s >> 3; return Math.max(3 - Math.min(f, 7 - f), 3 - Math.min(r, 7 - r)); }; // 0 in the middle .. 3 on the edge
function cEval(b) { // centipawns from WHITE's point of view
  let s = 0, wk = -1, bk = -1, wMat = 0, bMat = 0, wMen = 0, bMen = 0;
  for (let i = 0; i < 64; i++) { const ch = b[i]; if (ch === ".") continue;
    const white = ch === ch.toUpperCase(), t = ch.toLowerCase(), v = CV[t];
    if (t === "k") { if (white) wk = i; else bk = i; continue; }
    if (white) { wMat += v; if (t !== "p") wMen++; s += v + PST[t][i]; } else { bMat += v; if (t !== "p") bMen++; s -= v + PST[t][i ^ 56]; } }
  const endgame = wMat + bMat < 2600 || (wMen + bMen) <= 3;
  if (endgame) { s += (3 - cDist(wk)) * 8 - (3 - cDist(bk)) * 8; } else { s += PST.k[wk] - PST.k[bk ^ 56]; }
  // mop-up: a side that is well ahead drives the lone king to the edge and brings its own king close, so a won ending is actually won
  const kd = Math.abs((wk & 7) - (bk & 7)) + Math.abs((wk >> 3) - (bk >> 3));
  if (bMen === 0 && wMat - bMat > 250) s += cDist(bk) * 14 + (14 - kd) * 5;
  if (wMen === 0 && bMat - wMat > 250) s -= cDist(wk) * 14 + (14 - kd) * 5;
  return s;
}
const chessRights = (castle, m, p) => { let c = castle; const strip = (chars) => { for (const ch of chars) c = c.replace(ch, ""); };
  if (p === "K") strip("KQ"); if (p === "k") strip("kq");
  for (const s of [m.from, m.to]) { if (s === 63) strip("K"); if (s === 56) strip("Q"); if (s === 7) strip("k"); if (s === 0) strip("q"); }
  return c; };
const chessAfter = (pos, m) => ({ b: chessMake(pos.b, m).b, side: pos.side === "w" ? "b" : "w", castle: chessRights(pos.castle, m, pos.b[m.from]), ep: m.double ? (m.from + m.to) / 2 : -1 });
const isCapture = (pos, m) => pos.b[m.to] !== "." || !!m.ep;
const orderKey = (pos, m) => (isCapture(pos, m) ? 10 * (CV[(m.ep ? "p" : pos.b[m.to]).toLowerCase()] ?? 100) - (CV[pos.b[m.from].toLowerCase()] ?? 0) / 10 : 0) + (m.promo ? (m.promo === "q" ? 800 : 100) : 0);
const stm = (pos, white) => (pos.side === "w" ? white : -white); // a white-based score, seen from the side to move

function cQuiet(pos, alpha, beta, ply, cx, qd) {
  const stand = stm(pos, cEval(pos.b)); if (qd <= 0 || stand >= beta) return stand; if (stand > alpha) alpha = stand;
  cx.nodes++; if ((cx.nodes & 127) === 0 && Date.now() > cx.deadline) cx.abort = true; if (cx.abort) return 0;
  const caps = chessMoves(pos).filter((m) => isCapture(pos, m) || m.promo === "q").sort((x, y) => orderKey(pos, y) - orderKey(pos, x));
  for (const m of caps) { const v = -cQuiet(chessAfter(pos, m), -beta, -alpha, ply + 1, cx, qd - 1); if (cx.abort) return 0; if (v >= beta) return v; if (v > alpha) alpha = v; }
  return alpha;
}
function cSearch(pos, depth, alpha, beta, ply, cx) {
  cx.nodes++; if ((cx.nodes & 127) === 0 && Date.now() > cx.deadline) cx.abort = true; if (cx.abort) return 0;
  const moves = chessMoves(pos);
  if (!moves.length) return chessInCheck(pos.b, pos.side) ? -MATE + ply : 0;
  if (depth <= 0) return cQuiet(pos, alpha, beta, ply, cx, 3);
  moves.sort((x, y) => orderKey(pos, y) - orderKey(pos, x));
  let best = -Infinity;
  for (const m of moves) {
    const v = -cSearch(chessAfter(pos, m), depth - 1, -beta, -alpha, ply + 1, cx); if (cx.abort) return 0;
    if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break;
  }
  return best;
}
const chessMaterial = (b, white) => { let s = 0; for (const ch of b) { if (ch === "." || ch.toLowerCase() === "k") continue; s += (ch === ch.toUpperCase() ? 1 : -1) * CV[ch.toLowerCase()]; } return white ? s : -s; };

function chessChoose(state, seat, rng, skill, { budgetMs = 450 } = {}) {
  const pos = { b: state.board, side: state.side, castle: state.castle, ep: state.ep }, moves = chessMoves(pos);
  const act = (m) => ({ type: "move", from: sqName(m.from), to: sqName(m.to), ...(m.promo ? { promo: m.promo } : {}) });
  if (moves.length === 1) return act(moves[0]);
  moves.sort((x, y) => orderKey(pos, y) - orderKey(pos, x));
  const maxDepth = 2 + Math.round(skill * 2), margin = 35 + (1 - skill) * 150, cx = { nodes: 0, abort: false, deadline: Date.now() + budgetMs };
  let result = null;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const scored = []; let best = -Infinity, order = result ? [...moves].sort((x, y) => (result.get(y) ?? -1e9) - (result.get(x) ?? -1e9)) : moves;
    for (const m of order) {
      const after = chessAfter(pos, m), alpha = best === -Infinity ? -Infinity : best - margin;
      let v = -cSearch(after, depth - 1, -Infinity, -alpha, 1, cx); if (cx.abort) break;
      if (v > best) best = v; scored.push({ m, v });
    }
    if (cx.abort) break; // a half-searched depth is thrown away: the last whole one stands
    result = new Map(scored.map((s) => [s.m, s.v]));
    if (best >= MATE - 50) break; // mate found: no need to look deeper
  }
  if (!result) return act(pickOne(moves.slice(0, Math.min(moves.length, 8)), rng)); // out of time before depth 1 finished (cannot really happen): a capture or a developing move
  const seen = state.seen ?? {}, best = Math.max(...result.values());
  const scored = [...result.entries()].map(([m, v]) => { // do not walk into a repetition when ahead, and shuffle less when clearly winning
    const a = chessAfter(pos, m), n = seen[a.b + a.side + a.castle + (a.ep >= 0 ? a.ep : "-")] ?? 0;
    return { move: m, score: v - (n >= 2 && best > 50 ? 300 : n >= 1 && best > 200 ? 60 : 0) + rng() * 0.5 };
  });
  const opening = state.full <= 3;
  const m = choose(scored, skill, rng, { margin: best >= MATE - 100 ? 0 : opening ? 25 : margin, slip: opening ? 0.9 : 0.5 });
  return act(m);
}

// ================================================================================================ LUDO
const L_HOME = ludo.HOME, trackIdx = ludo.trackIndex, SAFE = ludo.SAFE;
function ludoRisk(foe, foeSeat, idx) { // how exposed a square of the loop is to the rival's tokens behind it (0 when it is safe)
  if (idx < 0 || SAFE.has(idx)) return 0;
  let r = 0; for (const q of foe) { if (q < 1 || q > 51) continue; const d = (idx - trackIdx(foeSeat, q) + 52) % 52; if (d >= 1 && d <= 6) r += (7 - d) / 6; }
  return r;
}
function ludoChoose(state, seat, rng, skill) {
  if (state.phase === "roll") return { type: "roll" };
  const dice = state.dice, me = state.tokens[seat], foe = state.tokens[1 - seat], can = ludo.movable(state, seat, dice), home = me.filter((p) => p === L_HOME).length, scored = [];
  for (const i of can) {
    const from = me[i], to = from === 0 ? 1 : from + dice, idx = trackIdx(seat, to), before = from >= 1 && from <= 51 ? trackIdx(seat, from) : -1;
    let s = to * 0.15;
    if (to === L_HOME) s += home === 3 ? 1000 : 45;
    for (const q of foe) if (idx >= 0 && !SAFE.has(idx) && q >= 1 && q <= 51 && trackIdx(1 - seat, q) === idx) s += 50 + q * 0.6; // a capture, worth more the further the token had come
    if (from === 0) s += 28;
    if (idx >= 0 && SAFE.has(idx)) s += 10; else if (to >= 52 && to < L_HOME) s += 14;
    s -= ludoRisk(foe, 1 - seat, idx) * 30; s += ludoRisk(foe, 1 - seat, before) * 24; // leave a square that is under threat, do not land on one
    s += (rng() - 0.5) * (1 - skill) * 40;
    scored.push({ move: { type: "move", token: i }, score: s });
  }
  return choose(scored, skill, rng);
}

// ================================================================================================ BASKETBALL
const HOOPS_ORDER = ["LAYUP", "THREE", "HALF"];
function hoopsSpot(state, seat, rng, skill) {
  const qHat = 0.42 + 0.45 * skill, left = Math.max(0, hoops.ROUNDS - state.shots[seat]), diff = state.score[seat] - state.score[1 - seat], w = [];
  for (const k of HOOPS_ORDER) {
    const ev = hoops.chance(k, qHat) * hoops.SPOTS[k].pts; let x = ev;
    if (state.sudden || left <= 2) { if (diff <= -3) x *= hoops.SPOTS[k].pts / 2.6; else if (diff >= 3) x *= 2.6 / hoops.SPOTS[k].pts; } // behind late: go for points; ahead: play safe
    w.push(Math.exp(x / 0.35));
  }
  let r = rng() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return HOOPS_ORDER[i]; }
  return "THREE";
}
/** How long after the meter started the AI lets go, in ms. Aimed at a release quality that depends on skill, so it makes most shots and misses some. */
export function hoopsRelease(state, bot, rng) {
  const zone = hoops.SPOTS[state.spot].zone, q = clamp(0.4 + 0.5 * bot.skill + gauss(rng) * 0.2, 0, 1);
  const m = clamp(state.zoneAt + (rng() < 0.5 ? -1 : 1) * (1 - q) * zone, 0.02, 1); // where on the meter it wants to let go
  // the meter runs 0 -> 1 -> 0 over one period: it is at m on the way up m/2 of a period in, and on the way down 1 - m/2 in
  let delay = (rng() < 0.5 ? m / 2 : 1 - m / 2) * hoops.PERIOD_MS + (rng() < 0.5 ? 0 : hoops.PERIOD_MS);
  if (delay < 650) delay += hoops.PERIOD_MS;
  return Math.round(delay + (rng() - 0.5) * 24);
}

// ================================================================================================ 8-BALL POOL
const P_R = pool.TABLE.r, P_W = pool.TABLE.w, P_H = pool.TABLE.h, HEAD_X = pool.HEAD;
function poolWants(state, seat) {
  const g = state.groups[seat], left = (grp) => state.balls.some((b, n) => n >= 1 && !b.in && pool.groupOf(n) === grp);
  if (!g) return "open"; return left(g) ? g : "eight";
}
const distSeg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0; return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
function poolChoose(state, seat, rng, skill, { budgetMs = 900 } = {}) {
  const noise = (a) => ({ ...a, angle: a.angle + gauss(rng) * (0.003 + (1 - skill) * 0.03), power: clamp(a.power * (1 + gauss(rng) * (0.01 + (1 - skill) * 0.05)), 0.05, 1) });
  if (state.breakShot) { // the break: the cue ball behind the line, hit hard at the head of the rack
    const cue = { x: 150 + rng() * 90, y: 130 + rng() * 240 };
    return noise({ type: "shot", angle: Math.atan2(250 - cue.y, 700 - cue.x), power: 0.82 + skill * 0.13, spin: 0, cue });
  }
  const balls = state.balls, want = poolWants(state, seat), t0 = Date.now(), ver = (state.last?.v ?? state.shots) + 1;
  const targets = []; for (let n = 1; n < 16; n++) { if (balls[n].in) continue; if (want === "open" ? n !== 8 : want === "eight" ? n === 8 : pool.groupOf(n) === want) targets.push(n); }
  const evaluate = (action) => { // play the shot on a copy of the table with the game's own rules and score what happens
    let res; try { res = pool.act(state, seat, action, { version: ver }); } catch { return -1e9; }
    const last = res.state.last, potted = last.potted ?? [];
    let v = 0; if (res.over) return res.over.winner === seat ? 10000 : -10000;
    if (last.foul) v -= 120;
    for (const n of potted) { const own = want === "open" ? n !== 8 : pool.groupOf(n) === (state.groups[seat] ?? pool.groupOf(n)); v += own ? 45 : -35; }
    if (res.state.turn === seat && !last.foul) v += 25;
    return v;
  };
  const cueOf = (c) => state.ballInHand ? { cue: c } : {};
  const shots = []; // candidate lines: a target, a pocket, and the cue ball position to play it from
  const fromCue = state.ballInHand ? null : { x: balls[0].x, y: balls[0].y };
  for (const t of targets) for (const [px, py] of pool.POCKETS) {
    const tx = balls[t].x, ty = balls[t].y, dx = px - tx, dy = py - ty, dist = Math.hypot(dx, dy); if (dist < 1) continue;
    const ux = dx / dist, uy = dy / dist, gx = tx - ux * 2 * P_R, gy = ty - uy * 2 * P_R;
    if (gx < P_R || gx > P_W - P_R || gy < P_R || gy > P_H - P_R) continue;
    let cueAt = fromCue;
    if (!cueAt) { // ball in hand: line the cue ball up straight behind the ghost ball, as far back as the table allows
      for (const back of [170, 110, 230]) { const cx = gx - ux * back, cy = gy - uy * back;
        if (cx < P_R + 2 || cx > P_W - P_R - 2 || cy < P_R + 2 || cy > P_H - P_R - 2) continue;
        if (balls.some((b, n) => n >= 1 && !b.in && Math.hypot(b.x - cx, b.y - cy) < 2 * P_R + 2)) continue;
        cueAt = { x: cx, y: cy }; break; }
      if (!cueAt) continue;
    }
    const cx = gx - cueAt.x, cy = gy - cueAt.y, cd = Math.hypot(cx, cy); if (cd < 2 * P_R) continue;
    const cos = (cx * ux + cy * uy) / cd; if (cos < 0.4) continue; // too thin a cut
    let clear = true; // nothing in the way of the cue ball, nor of the object ball on its way to the pocket
    for (let n = 1; n < 16 && clear; n++) { if (n === t || balls[n].in) continue; if (distSeg(balls[n].x, balls[n].y, cueAt.x, cueAt.y, gx, gy) < 2 * P_R - 1 || distSeg(balls[n].x, balls[n].y, tx, ty, px, py) < 2 * P_R - 1) clear = false; }
    if (!clear) continue;
    shots.push({ t, cueAt, angle: Math.atan2(cy, cx), cd, dist, ease: cos * 2 - (cd + dist) / 1200 - (px === 500 ? 0.15 : 0) });
  }
  shots.sort((a, b) => b.ease - a.ease);
  let best = null;
  for (const s of shots.slice(0, 12)) {
    if (Date.now() - t0 > budgetMs && best) break;
    const v0 = Math.sqrt(2 * 230 * (s.cd + 1.5 * s.dist)) + 110, p0 = clamp((v0 - 160) / 1640, 0.18, 0.95);
    for (const p of [p0, Math.min(0.95, p0 * 1.35 + 0.05)]) {
      const a = { type: "shot", angle: s.angle, power: p, spin: 0, ...cueOf(s.cueAt) }, v = evaluate(a) + (rng() - 0.5) * 2;
      if (!best || v > best.v) best = { a, v };
    }
  }
  if (!best || best.v <= 0) { // nothing makes a ball: play safe. Hit the nearest legal ball with a soft shot that cannot foul on contact, and keep the best of a few tries
    const c0 = fromCue ?? { x: Math.min(HEAD_X, 300), y: 250 };
    const order = [...targets].sort((x, y) => Math.hypot(balls[x].x - c0.x, balls[x].y - c0.y) - Math.hypot(balls[y].x - c0.x, balls[y].y - c0.y));
    for (const t of order.slice(0, 3)) for (const p of [0.35, 0.55, 0.75]) {
      if (Date.now() - t0 > budgetMs * 1.6 && best) break;
      const cue = fromCue ?? placeCue(balls, c0), a = { type: "shot", angle: Math.atan2(balls[t].y - cue.y, balls[t].x - cue.x), power: p, spin: 0, ...cueOf(cue) }, v = evaluate(a) + (rng() - 0.5) * 2;
      if (!best || v > best.v) best = { a, v };
    }
  }
  if (!best) { const cue = fromCue ?? placeCue(balls, { x: 300, y: 250 }); return noise({ type: "shot", angle: rng() * Math.PI * 2, power: 0.5, spin: 0, ...cueOf(cue) }); }
  return noise(best.a);
}
function placeCue(balls, from) { // a free spot for the cue ball when it is in hand and no better one was found
  for (let k = 0; k < 40; k++) { const x = clamp(from.x + (k % 5) * 30, P_R + 2, P_W - P_R - 2), y = clamp(from.y + ((k / 5) | 0) * 30 - 60, P_R + 2, P_H - P_R - 2);
    if (!balls.some((b, n) => n >= 1 && !b.in && Math.hypot(b.x - x, b.y - y) < 2 * P_R + 2)) return { x, y }; }
  return { x: 150, y: 250 };
}

// ================================================================================================ WHOT
function whotChoose(state, seat, rng, skill) {
  const m = whot.chooseMove(state, seat, rng);
  if (m.type !== "play" || (1 - skill) * 0.12 < rng()) return m;
  const ok = state.hands[seat].filter((c) => whot.canPlay(state, c) && c.id !== m.card); // an occasional second-best card, never an illegal one and never one that is worse than going out
  if (!ok.length || state.hands[seat].length <= 2) return m;
  const c = pickOne(ok, rng);
  return c.s === "whot" ? { type: "play", card: c.id, shape: pickOne(whot.SHAPES, rng) } : { type: "play", card: c.id };
}

// ================================================================================================ every legal action (for fallbacks and tests)
/** All legal actions for `seat` now. Pool has endless shots, so a handful of aimed ones stand in for them. */
export function legalActions(game, state, seat, rng = Math.random) {
  switch (game) {
    case "TICTACTOE": return state.board.flatMap((c, i) => (c === 0 ? [{ type: "mark", cell: i }] : []));
    case "CONNECT4": return [0, 1, 2, 3, 4, 5, 6].filter((c) => state.board[c] === 0).map((col) => ({ type: "drop", col }));
    case "CHECKERS": return checkers.legalMoves(state.board, seat).map((m) => ({ type: "move", path: m.path }));
    case "CHESS": return chessMoves({ b: state.board, side: state.side, castle: state.castle, ep: state.ep }).map((m) => ({ type: "move", from: sqName(m.from), to: sqName(m.to), ...(m.promo ? { promo: m.promo } : {}) }));
    case "LUDO": return state.phase === "roll" ? [{ type: "roll" }] : ludo.movable(state, seat, state.dice).map((token) => ({ type: "move", token }));
    case "HOOPS": return state.phase === "pick" ? HOOPS_ORDER.map((spot) => ({ type: "pick", spot })) : [{ type: "release", elapsed: 700 + Math.floor(rng() * 700) }];
    case "POOL": { const cue = state.ballInHand ? { cue: state.breakShot ? { x: 200, y: 250 } : placeCue(state.balls, { x: 300, y: 250 }) } : {}; return [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ type: "shot", angle: (k / 8) * Math.PI * 2 + rng() * 0.3, power: 0.6, spin: 0, ...cue })); }
    case "WHOT": { const ok = state.hands[seat].filter((c) => whot.canPlay(state, c)); return ok.length ? ok.map((c) => (c.s === "whot" ? { type: "play", card: c.id, shape: pickOne(whot.SHAPES, rng) } : { type: "play", card: c.id })) : [{ type: "draw" }]; }
    default: return [];
  }
}

// ================================================================================================ the entry points the match service uses
/** The action the AI plays now. `seed` makes it repeatable; `opts.budgetMs` bounds the search for chess and pool (tests use a small one). */
export function botAction(game, state, seat, bot, seed, opts = {}) {
  const rng = seeded(hashSeed(seed, "move")), skill = bot.skill;
  switch (game) {
    case "TICTACTOE": return t3Choose(state, seat, rng, skill);
    case "CONNECT4": return c4Choose(state, seat, rng, skill);
    case "CHECKERS": return ckChoose(state, seat, rng, skill);
    case "CHESS": return chessChoose(state, seat, rng, skill, { budgetMs: opts.budgetMs ?? 450 });
    case "LUDO": return ludoChoose(state, seat, rng, skill);
    case "HOOPS": return state.phase === "pick" ? { type: "pick", spot: hoopsSpot(state, seat, rng, skill) } : { type: "release", elapsed: hoopsRelease(state, bot, seeded(hashSeed(seed, "release"))) };
    case "POOL": return poolChoose(state, seat, rng, skill, { budgetMs: opts.budgetMs ?? 900 });
    case "WHOT": return whotChoose(state, seat, rng, skill);
    default: throw new Error("The AI does not play " + game);
  }
}

const THINK = { TICTACTOE: [900, 2400], CONNECT4: [1200, 3600], CHECKERS: [1600, 5200], CHESS: [2200, 8500], LUDO: [800, 1900], HOOPS: [900, 2300], POOL: [3800, 8200], WHOT: [1400, 4000] };
const MAX_THINK_FRACTION = 0.4; // never more than this share of the game's own turn clock
/** How many ms after the last move the AI makes its next one. Cheap to work out, repeatable for a seed, and in the range a person would take for that game. */
export function thinkMs(game, state, seat, bot, seed, turnSeconds = 60) {
  const r = seeded(hashSeed(seed, "think"));
  if (game === "HOOPS" && state.phase === "meter") return hoopsRelease(state, bot, seeded(hashSeed(seed, "release"))); // the meter decides: it is when the AI lets go
  const [lo, hi] = THINK[game] ?? [1000, 3000];
  const options = legalActions(game, state, seat, r).length;
  let ms;
  if (game === "POOL") ms = state.breakShot ? 2500 + r() * 1500 : lo + (hi - lo) * (0.2 + 0.8 * r());
  else if (options <= 1) ms = lo * (0.55 + 0.4 * r()); // a forced move is quick
  else ms = lo + (hi - lo) * (0.1 + 0.9 * r()) * Math.min(1, 0.45 + options / 28);
  if (game === "LUDO" && state.phase === "roll") ms = 600 + r() * 900;
  return Math.round(clamp(ms * bot.tempo, 500, Math.min(10_000, turnSeconds * 1000 * MAX_THINK_FRACTION)));
}
/** Does the AI accept a draw offer now? Only when it is not doing well (a person would not give up a good position), and never in games with no such thing as a standing. */
export function botAcceptsDraw(game, state, seat, seed) {
  const r = seeded(hashSeed(seed, "draw"));
  if (game === "CHESS") { const mat = chessMaterial(state.board, state.white === seat); return mat <= -150 || (state.half >= 40 && Math.abs(mat) < 100 && r() < 0.6) || (mat < 0 && state.full > 50 && r() < 0.5); }
  if (game === "CHECKERS") { let mine = 0, theirs = 0; for (const p of state.board) { if (!p) continue; const v = kingP(p) ? 2 : 1; if (ownerOf(p) === seat) mine += v; else theirs += v; } return mine < theirs || (state.idle ?? 0) >= 30; }
  return false;
}
