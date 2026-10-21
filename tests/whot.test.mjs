// tests/whot.test.mjs: the Whot rules (lib/games/whot.js): the deck, matching, every power card, picks and counters, the market, winning, what each player may see,
// and a few hundred computer-against-computer games that must always finish with the cards all accounted for.
import assert from "node:assert/strict";
import * as W from "../lib/games/whot.js";
import { ENGINES, GAME_IDS, isGame } from "../lib/games/index.js";
import { RuleError } from "../lib/games/errors.js";

const ok = (m) => console.log("OK  ", m);
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const refuses = (label, fn, re) => { try { fn(); } catch (e) { assert.ok(e instanceof RuleError, `${label}: expected a RuleError, got ${e?.stack}`); if (re) assert.match(e.message, re, label); ok(`refused: ${label} -> ${e.message}`); return; } assert.fail(label + ": should have been refused"); };
const C = (id, s, n) => ({ id, s, n });
/** A hand-built position: seat 0 to move unless said otherwise. */
const pos = (o) => ({ turn: 0, first: 0, hands: [[], []], market: [C(100, "circle", 3), C(101, "square", 7), C(102, "star", 4), C(103, "cross", 10), C(104, "circle", 12), C(105, "triangle", 4)], discard: [C(99, "circle", 4)], want: null, pending: null, moves: 0, done: false, last: null, log: [], ...o });

// ---------- registry
assert.ok(isGame("WHOT") && GAME_IDS.includes("WHOT") && ENGINES.WHOT.info.id === "WHOT"); ok("Whot is registered with the other games");

// ---------- the deck
const deck = W.buildDeck(), by = (s) => deck.filter((c) => c.s === s);
assert.equal(deck.length, 54); assert.equal(new Set(deck.map((c) => c.id)).size, 54);
assert.deepEqual(by("circle").map((c) => c.n), [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]); assert.deepEqual(by("triangle").map((c) => c.n), [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]);
assert.deepEqual(by("cross").map((c) => c.n), [1, 2, 3, 5, 7, 10, 11, 13, 14]); assert.deepEqual(by("square").map((c) => c.n), [1, 2, 3, 5, 7, 10, 11, 13, 14]);
assert.deepEqual(by("star").map((c) => c.n), [1, 2, 3, 4, 5, 7, 8]); assert.equal(by("whot").length, 5); assert.ok(by("whot").every((c) => c.n === 20));
ok("the deck is the 54 Nigerian Whot cards (12 + 12 + 9 + 9 + 7 + five Whot 20s)");

// ---------- dealing
for (let seed = 1; seed <= 60; seed++) {
  const st = W.create(seeded(seed)), all = [...st.hands[0], ...st.hands[1], ...st.market, ...st.discard];
  assert.equal(st.hands[0].length, 6); assert.equal(st.hands[1].length, 6); assert.equal(st.discard.length, 1); assert.equal(all.length, 54); assert.equal(new Set(all.map((c) => c.id)).size, 54);
  const t = st.discard[0]; assert.ok(t.s !== "whot" && !W.isPower(t), "the starter is a plain card"); assert.ok(st.turn === 0 || st.turn === 1);
}
ok("60 deals: six cards each, a plain starter card, all 54 cards present once");

// ---------- matching
let st = pos({ hands: [[C(1, "circle", 9 - 2), C(2, "star", 4), C(3, "cross", 3), C(4, "whot", 20)], [C(5, "square", 1)]] });
assert.deepEqual(W.playable(st, 0).sort(), [1, 2, 4]); ok("circle 4 on the pile: same shape (circle 7), same number (star 4) and Whot are playable; cross 3 is not");
refuses("a card that matches neither shape nor number", () => W.act(st, 0, { type: "play", card: 3 }), /neither/);
refuses("a card that is not in your hand", () => W.act(st, 0, { type: "play", card: 5 }), /not in your hand/);
refuses("playing out of turn", () => W.act(st, 1, { type: "play", card: 5 }), /not your turn/);
refuses("going to market with a playable card", () => W.act(st, 0, { type: "draw" }), /can play/);
refuses("a Whot with no shape named", () => W.act(st, 0, { type: "play", card: 4 }), /Choose the shape/);
refuses("a Whot asking for 'whot'", () => W.act(st, 0, { type: "play", card: 4, shape: "whot" }), /Choose the shape/);
refuses("an unknown action", () => W.act(st, 0, { type: "win" }), /Play a card/);
let r = W.act(st, 0, { type: "play", card: 2 }); assert.equal(r.state.turn, 1); assert.equal(r.state.discard.at(-1).id, 2); assert.equal(r.state.hands[0].length, 3); ok("a plain card moves to the pile and the turn passes");
assert.equal(st.hands[0].length, 4); ok("the previous state is never changed in place");

// ---------- Whot card
r = W.act(st, 0, { type: "play", card: 4, shape: "triangle" }); assert.equal(r.state.want, "triangle"); assert.equal(r.state.turn, 1);
let s2 = pos({ ...r.state, hands: [r.state.hands[0], [C(6, "circle", 4), C(7, "triangle", 9), C(8, "whot", 20)]] });
assert.deepEqual(W.playable(s2, 1).sort(), [7, 8]); ok("after Whot asks for triangle only a triangle or another Whot may follow (a circle 4 matching the old pile is refused)");
refuses("not the asked shape", () => W.act(s2, 1, { type: "play", card: 6 }), /Triangle/);
r = W.act(s2, 1, { type: "play", card: 7 }); assert.equal(r.state.want, null); ok("playing the asked shape clears the request");

// ---------- hold on and suspension (two players: you play again)
st = pos({ hands: [[C(1, "circle", 1), C(2, "circle", 8), C(3, "star", 9)], [C(5, "square", 2)]] });
r = W.act(st, 0, { type: "play", card: 1 }); assert.equal(r.state.turn, 0); ok("1 Hold on: the same player plays again");
r = W.act(st, 0, { type: "play", card: 2 }); assert.equal(r.state.turn, 0); assert.equal(r.state.last.effect, "suspend"); ok("8 Suspension: the rival misses a turn, so the same player plays again");

// ---------- general market
st = pos({ hands: [[C(1, "circle", 14), C(2, "cross", 1)], [C(5, "square", 2)]] });
r = W.act(st, 0, { type: "play", card: 1 }); assert.equal(r.state.hands[1].length, 2); assert.equal(r.state.turn, 0); assert.equal(r.state.market.length, 5); ok("14 General market: the rival picks one and the player goes again");

// ---------- pick two, pick three, counters and stacking
st = pos({ hands: [[C(1, "circle", 2), C(2, "star", 5)], [C(5, "square", 2), C(6, "cross", 5), C(7, "circle", 7)]] });
r = W.act(st, 0, { type: "play", card: 1 }); assert.deepEqual(r.state.pending, { n: 2, count: 2 }); assert.equal(r.state.turn, 1);
assert.deepEqual(W.playable(r.state, 1), [5]); ok("pick two: only a 2 can answer (a matching circle 7 and a 5 are not allowed)");
refuses("answering a pick with the wrong card", () => W.act(r.state, 1, { type: "play", card: 7 }), /Answer with a 2/);
const stacked = W.act(r.state, 1, { type: "play", card: 5 }); assert.deepEqual(stacked.state.pending, { n: 2, count: 4 }); assert.equal(stacked.state.turn, 0); ok("a 2 answered with a 2 passes four to the first player");
let took = W.act(r.state, 1, { type: "draw" }); assert.equal(took.state.hands[1].length, 5); assert.equal(took.state.pending, null); assert.equal(took.state.turn, 0); assert.equal(took.state.last.forced, true); ok("taking the pick: two cards, the penalty is cleared and the turn passes");
r = W.act(pos({ hands: [[C(2, "star", 5)], [C(5, "square", 2), C(6, "cross", 5), C(7, "circle", 7)]], discard: [C(99, "star", 2)] }), 0, { type: "play", card: 2 });
assert.equal(r.over?.winner, 0, "a last card wins at once, even a power card"); ok("winning on a 5 ends the game immediately");
r = W.act(pos({ hands: [[C(2, "star", 5), C(3, "star", 9)], [C(5, "square", 2), C(6, "cross", 5), C(7, "circle", 7)]], discard: [C(99, "star", 2)] }), 0, { type: "play", card: 2 });
assert.deepEqual(r.state.pending, { n: 5, count: 3 }); assert.deepEqual(W.playable(r.state, 1), [6]); ok("pick three: only a 5 answers");
took = W.act(r.state, 1, { type: "draw" }); assert.equal(took.state.hands[1].length, 6); ok("taking a pick three adds three cards");

// ---------- the market
st = pos({ hands: [[C(1, "cross", 3)], [C(5, "square", 2)]] });
r = W.act(st, 0, { type: "draw" }); assert.equal(r.state.hands[0].length, 2); assert.equal(r.state.turn, 1); assert.equal(r.state.market.length, 5); assert.equal(r.state.pending, null); ok("market: one card, then the turn passes");
let empty = pos({ market: [], discard: [C(10, "circle", 3), C(11, "star", 3), C(12, "cross", 3), C(99, "circle", 4)], hands: [[C(1, "cross", 13)], [C(5, "square", 2)]] });
r = W.act(empty, 0, { type: "draw" }, { rng: seeded(9) }); assert.equal(r.state.hands[0].length, 2); assert.equal(r.state.discard.length, 1); assert.equal(r.state.discard[0].id, 99); assert.equal(r.state.market.length, 2); ok("an empty market is refilled from the discard pile, and the top card stays");
let dry = pos({ market: [], discard: [C(99, "circle", 4)], hands: [[C(1, "cross", 13)], [C(5, "square", 2)]] });
r = W.act(dry, 0, { type: "draw" }); assert.equal(r.over.winner, 1); ok("nothing left to draw: the game ends and the lower hand (square 2 against cross 13) wins");
dry.hands = [[C(1, "cross", 2)], [C(5, "square", 2)]]; assert.equal(W.act(dry, 0, { type: "draw" }).over.winner, null); ok("equal hands in a stalemate draw");
assert.equal(W.handPoints([C(1, "star", 4), C(2, "whot", 20), C(3, "cross", 3)]), 8 + 20 + 3); ok("stars count double and Whot counts 20");

// ---------- what each player may see
st = W.create(seeded(5)); const v0 = W.view(st, 0), v1 = W.view(st, 1);
assert.deepEqual(v0.hand, st.hands[0]); assert.deepEqual(v1.hand, st.hands[1]); assert.equal(v0.counts[1], 6); assert.equal(v0.opponentHand, null);
const json = JSON.stringify(v0); for (const c of st.hands[1]) assert.ok(!json.includes(JSON.stringify(c)) || st.hands[0].some((x) => x.id === c.id), "the rival's cards are never sent");
assert.equal(v0.market, st.market.length); assert.ok(!("hands" in v0) && !("marketCards" in v0)); ok("a player sees their own hand and only the NUMBER of the rival's cards and of the market");
const mover = st.turn; assert.equal(W.view(st, mover).canDraw, W.view(st, mover).playable.length === 0); assert.equal(W.view(st, 1 - mover).playable.length, 0); assert.equal(W.view(st, 1 - mover).canDraw, false); ok("only the player to move is told what is playable");
const fin = W.act(pos({ hands: [[C(1, "circle", 7)], [C(5, "square", 2)]] }), 0, { type: "play", card: 1 }); assert.deepEqual(W.view(fin.state, 0).opponentHand, [C(5, "square", 2)]); ok("when the game ends the rival's hand is shown");
refuses("a move after the game is over", () => W.act(fin.state, 1, { type: "draw" }), /over/);

// ---------- the computer: only legal moves, whole games
function playOut(seed) {
  const rng = seeded(seed); let state = W.create(rng), steps = 0, over = null;
  while (!over) {
    assert.ok(++steps < 3000, `game ${seed} did not end`);
    const seat = state.turn, before = state, mv = W.chooseMove(state, seat, rng);
    const res = W.act(state, seat, mv, { rng }); state = res.state; over = res.over;
    const all = [...state.hands[0], ...state.hands[1], ...state.market, ...state.discard];
    assert.equal(all.length, 54, `game ${seed}: a card was lost`); assert.equal(new Set(all.map((c) => c.id)).size, 54, `game ${seed}: a card was duplicated`);
    assert.equal(before.hands[0].length + before.hands[1].length > 0, true);
  }
  return { over, steps, state };
}
let wins = [0, 0], draws = 0, longest = 0;
for (let seed = 1; seed <= 400; seed++) { const g = playOut(seed); longest = Math.max(longest, g.steps); if (g.over.winner == null) draws++; else wins[g.over.winner]++; if (g.over.winner != null) assert.equal(g.state.hands[g.over.winner].length === 0 || /lower|Lowest/.test(g.over.reason), true); }
ok(`400 computer-against-computer games all finished (longest ${longest} moves; wins ${wins.join(" / ")}, draws ${draws}); no card was ever lost or duplicated`);
console.log("\nAll Whot tests passed.");
