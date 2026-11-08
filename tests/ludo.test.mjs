// tests/ludo.test.mjs: the two-dice Ludo engine (lib/games/ludo.js). Dice come from the server's rng, each die is one move, doubles roll again, three doubles lose the turn.
import assert from "node:assert/strict";
import * as L from "../lib/games/ludo.js";
let n = 0; const ok = (m) => console.log("OK  ", ++n, m);
const seq = (...v) => { let i = 0; return () => (v[i++] % 6) / 6 + 0.01; }; // rng that gives the dice in order (1..6 -> value-1 sixths)
const D = (a, b) => seq(a - 1, b - 1);
const base = (o = {}) => ({ ...L.create(() => 0.1), turn: 0, ...o }); // create(() => 0.1) -> seat 0 starts
const roll = (st, seat, a, b) => L.act(st, seat, { type: "roll" }, { rng: D(a, b) }).state;
const refuses = (label, fn, re) => { assert.throws(fn, (e) => e instanceof Error && re.test(e.message), label); ok("refused: " + label); };

// two dice, individually visible
let st = base({ tokens: [[0, 10, 20, 0], [0, 0, 0, 0]] }); st = roll(st, 0, 3, 5);
assert.deepEqual(st.dice, [3, 5]); assert.deepEqual(st.left, [3, 5]); assert.equal(st.phase, "move"); ok("a roll gives two dice, both kept");
let v = L.view(st, 0); assert.deepEqual(v.dice, [3, 5]); assert.deepEqual(v.options.map((o) => o.die), [3, 5]); assert.deepEqual(v.used, [false, false]); ok("the view lists both dice and the tokens each can move");
assert.deepEqual(L.view(st, 1).options, []); ok("the waiting player is offered no moves");

// each die is a separate move, in either order, on the same or different tokens
let r = L.act(st, 0, { type: "move", token: 1, die: 5 }); assert.equal(r.state.tokens[0][1], 15); assert.deepEqual(r.state.left, [3]); assert.equal(r.state.phase, "move"); assert.equal(r.state.turn, 0);
assert.deepEqual(L.view(r.state, 0).used, [false, true]); ok("playing the 5 first moves one token 5 and leaves the 3 to play");
r = L.act(r.state, 0, { type: "move", token: 1, die: 3 }); assert.equal(r.state.tokens[0][1], 18); assert.equal(r.state.turn, 1); assert.equal(r.state.phase, "roll"); assert.equal(r.state.dice, null); ok("the second die can go on the same token; then the turn passes");
r = L.act(st, 0, { type: "move", token: 1, die: 3 }); r = L.act(r.state, 0, { type: "move", token: 2, die: 5 }); assert.deepEqual(r.state.tokens[0], [0, 13, 25, 0]); ok("or on a different token, dice in either order");
refuses("a die that was not rolled", () => L.act(st, 0, { type: "move", token: 1, die: 4 }), /dice you still have/);
refuses("a die already played", () => { const a = L.act(st, 0, { type: "move", token: 1, die: 5 }).state; return L.act(a, 0, { type: "move", token: 1, die: 5 }); }, /dice you still have/);
refuses("moving out of turn", () => L.act(st, 1, { type: "roll" }), /not your turn/);
refuses("rolling again before moving", () => L.act(st, 0, { type: "roll" }), /Move a token first/);
refuses("moving before rolling", () => L.act(base(), 0, { type: "move", token: 0, die: 1 }), /Roll the dice first/);
refuses("a token still in the yard without a 6", () => L.act(st, 0, { type: "move", token: 0, die: 3 }), /need a 6/);

// a 6 brings a token out, and the other die can then move it
st = roll(base(), 0, 6, 2); r = L.act(st, 0, { type: "move", token: 0, die: 6 }); assert.equal(r.state.tokens[0][0], 1); r = L.act(r.state, 0, { type: "move", token: 0, die: 2 }); assert.equal(r.state.tokens[0][0], 3); assert.equal(r.state.turn, 1); ok("a 6 brings a token out and the other die walks it");
// no move at all: the turn passes and the dice are still shown
st = roll(base(), 0, 2, 3); assert.equal(st.turn, 1); assert.deepEqual(st.last.dice, [2, 3]); assert.equal(st.last.pass, "no move"); ok("two dice and nothing movable: the turn passes, the roll is kept for the screen");
// a die nobody can play is lost, the turn passes
st = base({ tokens: [[56, 0, 0, 0], [0, 0, 0, 0]] }); st = roll(st, 0, 1, 4); r = L.act(st, 0, { type: "move", token: 0, die: 1 }); assert.equal(r.state.tokens[0][0], 57); assert.equal(r.state.turn, 1); ok("a die that cannot be played (needs exact to get home) is forfeited");
// doubles: roll again, third double loses the turn
st = base({ tokens: [[10, 0, 0, 0], [0, 0, 0, 0]] }); st = roll(st, 0, 2, 2); r = L.act(st, 0, { type: "move", token: 0, die: 2 }); r = L.act(r.state, 0, { type: "move", token: 0, die: 2 });
assert.equal(r.state.turn, 0); assert.equal(r.state.phase, "roll"); assert.equal(r.state.doubles, 1); ok("a double: both dice played, then the same player rolls again");
st = r.state; st = roll(st, 0, 3, 3); r = L.act(st, 0, { type: "move", token: 0, die: 3 }); r = L.act(r.state, 0, { type: "move", token: 0, die: 3 }); assert.equal(r.state.doubles, 2); assert.equal(r.state.turn, 0);
st = roll(r.state, 0, 4, 4); assert.equal(st.turn, 1); assert.equal(st.last.pass, "three doubles"); assert.equal(st.doubles, 0); assert.equal(st.tokens[0][0], 20); ok("the third double in a row loses the turn without moving");
st = roll(base({ tokens: [[10, 0, 0, 0], [0, 0, 0, 0]], doubles: 1 }), 0, 2, 3); assert.equal(st.doubles, 0); ok("a roll that is not a double resets the count");
// capture, safe squares
const fp = (seat, idx) => ((idx - L.START[seat] + 52) % 52) + 1; // progress of `seat` standing on TRACK index idx
let tk = base({ tokens: [[fp(0, 10) - 4, 0, 0, 0], [0, 0, 0, 0]] }); tk.tokens[1][0] = fp(1, 10); st = roll(tk, 0, 4, 1); r = L.act(st, 0, { type: "move", token: 0, die: 4 }); assert.equal(r.state.tokens[1][0], 0); assert.deepEqual(r.state.last.captured, [0]); ok("landing on a lone opponent token sends it to the yard");
tk = base({ tokens: [[fp(0, 8) - 4, 0, 0, 0], [0, 0, 0, 0]] }); tk.tokens[1][0] = fp(1, 8); st = roll(tk, 0, 4, 1); r = L.act(st, 0, { type: "move", token: 0, die: 4 }); assert.equal(r.state.tokens[1][0], fp(1, 8)); ok("a safe square is not capturable");
// winning
st = base({ tokens: [[57, 57, 57, 55], [0, 0, 0, 0]] }); st = roll(st, 0, 2, 5); r = L.act(st, 0, { type: "move", token: 3, die: 2 }); assert.deepEqual(r.over, { winner: 0, reason: "All four tokens are home." }); assert.equal(r.state.phase, "done"); ok("the last token home wins at once, even with a die left over");
// a legacy single-die match keeps working
const old = { turn: 0, tokens: [[5, 0, 0, 0], [0, 0, 0, 0]], dice: 4, sixes: 0, phase: "move", log: [], last: null, moves: 3 };
assert.deepEqual(L.legalMoves(old, 0), [{ token: 0, die: 4 }]); r = L.act(old, 0, { type: "move", token: 0 }); assert.equal(r.state.tokens[0][0], 9); assert.equal(r.state.turn, 1); assert.equal(L.view(old, 0).options[0].die, 4); ok("a match saved with one die: still playable, token move needs no die");
// whole random games always finish and never reach an illegal state
for (let g = 1; g <= 60; g++) {
  let seed = g * 7919; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let s = L.create(rng), over = null, steps = 0;
  while (!over && steps++ < 6000) { const seat = s.turn; if (s.phase === "roll") s = L.act(s, seat, { type: "roll" }, { rng }).state; else { const mv = L.legalMoves(s, seat); assert.ok(mv.length, "in the move phase something must be playable"); const m = mv[Math.floor(rng() * mv.length)]; const x = L.act(s, seat, { type: "move", ...m }); s = x.state; over = x.over; } for (const t of s.tokens.flat()) assert.ok(t >= 0 && t <= 57); }
  assert.ok(over, "game " + g + " finished");
}
ok("60 random games: every one finishes, no token ever leaves 0..57, a move phase always has a legal move");
console.log("\nAll Ludo engine checks passed");
