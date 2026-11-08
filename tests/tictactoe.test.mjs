// tests/tictactoe.test.mjs: Tic-Tac-Toe rounds (lib/games/tictactoe.js): the round counter, who opens, scores carrying over, drawn rounds, and when the match really ends.
import assert from "node:assert/strict";
import * as T from "../lib/games/tictactoe.js";
let n = 0; const ok = (m) => console.log("OK  ", ++n, m);
const start = (first = 0) => ({ ...T.create(() => (first === 0 ? 0.1 : 0.9)) });
/** Plays one round: `winner` seat wins (0/1), or null for a draw. The opener moves first. Returns the state after the last mark. */
function round(st, winner) {
  const WIN = [[0, 1, 2], [4, 5, 8]], DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8]; // draw order: X O X ... fills the board with no line
  let r = { state: st, over: null }, s = st;
  if (winner == null) { for (const c of DRAW) { r = T.act(s, s.turn, { type: "mark", cell: c }); s = r.state; if (r.over) break; } return r; }
  const w = winner, l = 1 - w, mine = [0, 1, 2], theirs = [3, 4, 6]; // winner takes the top row, loser plays 3, 4 and 6 (no line)
  let wi = 0, li = 0;
  while (wi < 3) { const seat = s.turn; const c = seat === w ? mine[wi++] : theirs[li++]; r = T.act(s, seat, { type: "mark", cell: c }); s = r.state; }
  return r;
}
const mk = (st, seat, cells) => cells.reduce((a, c) => T.act(a, a.turn, { type: "mark", cell: c }).state, st);

// round 1 -> 2 -> 3: a split goes to a decider, and the round number and scores follow
let st = start(0), r = round(st, 0);
assert.equal(r.over, null); assert.equal(r.state.round, 2); assert.deepEqual(r.state.wins, [1, 0]); assert.ok(r.state.board.every((c) => c === 0)); assert.equal(r.state.turn, 1, "the other player opens round 2"); ok("round 1 won: round 2 starts with an empty board, the score is 1-0 and the other player opens");
r = round(r.state, 1);
assert.equal(r.over, null); assert.equal(r.state.round, 3); assert.deepEqual(r.state.wins, [1, 1]); assert.ok(r.state.board.every((c) => c === 0)); assert.equal(r.state.turn, 0); ok("round 2 won by the other player: 1-1, and the match goes on to round 3 (the case that used to stall)");
const v = T.view(r.state, 0); assert.equal(v.round, 3); assert.deepEqual(v.wins, [1, 1]); assert.equal(v.rounds.length, 2); assert.ok(v.prev && v.prev.board.some((c) => c !== 0)); ok("the view carries the round, scores, results so far and the finished board (prev) for the screen's brief replay");
r = round(r.state, 0); assert.deepEqual(r.over, { winner: 0, reason: "Won 2 to 1." }); ok("round 3 decides it: the match ends only now, 2-1");

// straight wins end the match at once
r = round(round(start(1), 1).state, 1); assert.ok(r.over && r.over.winner === 1 && /2 to 0/.test(r.over.reason)); assert.equal(r.state.round, 2); ok("two wins in a row end the match 2-0 without a third round");
// losses are the mirror image
r = round(round(start(0), 1).state, 1); assert.equal(r.over.winner, 1); ok("the second seat can win it too");

// draws replay the round; scores carry over; at most five rounds
st = start(0); let d = round(st, null);
assert.equal(d.over, null); assert.equal(d.state.round, 2); assert.deepEqual(d.state.wins, [0, 0]); assert.deepEqual(d.state.rounds[0], { round: 1, winner: null, line: null }); ok("a drawn round is replayed: round 2, nothing scored");
d = round(d.state, 0); d = round(d.state, null); assert.equal(d.over, null); assert.equal(d.state.round, 4); assert.deepEqual(d.state.wins, [1, 0]); ok("a win then a draw: the score carries over (1-0) into round 4");
d = round(d.state, 1); assert.equal(d.over, null); assert.equal(d.state.round, 5); assert.deepEqual(d.state.wins, [1, 1]); ok("1-1 after four rounds: a fifth and last round is played");
let e = round(d.state, null); assert.deepEqual(e.over, { winner: null, reason: "Still level after five rounds." }); ok("a drawn fifth round leaves it level: the match is a draw");
e = round(d.state, 1); assert.equal(e.over.winner, 1); ok("a won fifth round decides the match");
st = start(0); let q = st; for (let i = 0; i < 5; i++) { q = round(q, null); if (q.over) break; q = q.state; } assert.ok(q.over && q.over.winner === null); ok("five drawn rounds in a row: ends level after round 5, not before");

// rules
refuses: { assert.throws(() => T.act(start(0), 1, { type: "mark", cell: 0 }), /not your turn/); const s1 = mk(start(0), 0, [4]); assert.throws(() => T.act(s1, 1, { type: "mark", cell: 4 }), /taken/); assert.throws(() => T.act(s1, 1, { type: "mark", cell: 9 }), /Pick a square/); } ok("out of turn, a taken square and a square off the board are refused");
// whole-match fuzz: every game ends, in 2-5 rounds, with a consistent final score
for (let g = 0; g < 300; g++) {
  let seed = g * 104729 + 1; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let s = T.create(rng), over = null, guard = 0, lastRound = 1;
  while (!over && guard++ < 60) { const free = s.board.map((c, i) => (c === 0 ? i : -1)).filter((i) => i >= 0); const x = T.act(s, s.turn, { type: "mark", cell: free[Math.floor(rng() * free.length)] }); s = x.state; over = x.over; assert.ok(s.round >= lastRound && s.round <= T.MAX_ROUNDS); lastRound = s.round; }
  assert.ok(over, "match " + g + " ended"); assert.ok(s.wins[0] === T.WIN_ROUNDS || s.wins[1] === T.WIN_ROUNDS || s.round === T.MAX_ROUNDS, "ended for a real reason");
}
ok("300 random matches: each ends (never earlier than a player's second win or round 5) and the round number never goes backwards");
console.log("\nAll Tic-Tac-Toe checks passed");
