// lib/games/whot.js
// Whot (Nigerian style) for two players, decided entirely on the server: the deck is shuffled here, each player is only ever shown their own hand, and every play is
// checked against the rules below. A browser can only say "play this card" or "go to market".
//
// THE RULE SET (one fixed set, used by the server, the practice game against the computer and the tests):
//  Deck      54 cards. Circle, Triangle: 1 2 3 4 5 7 8 10 11 12 13 14.  Cross, Square: 1 2 3 5 7 10 11 13 14.  Star: 1 2 3 4 5 7 8.  Five Whot cards (20).
//  Deal      6 cards each. The first card of the discard pile is turned from the market and is always a plain card (never 1, 2, 5, 8, 14 or Whot). The first player is random.
//  Playing   A card may be played if it has the same SHAPE or the same NUMBER as the top of the discard pile. A Whot card may be played on anything (except to answer a
//            pick). You must play a card if you have one you can play; you may go to the market only when you cannot, or to take a pick penalty.
//  Market    Going to the market draws ONE card and ends your turn. When the market runs out, the discard pile (except its top card) is shuffled to make a new one.
//  Specials  1  Hold on:  play again.
//            8  Suspension: your rival misses a turn, so you play again.
//            2  Pick two:   your rival must pick two, unless they answer with a 2 of any shape, which passes four to you (and so on, up the stack).
//            5  Pick three: the same with 5s (three each).
//            14 General market: your rival picks one card, and you play again.
//            Whot (20): play it on anything and name the shape that must be played next. The only card that may follow is that shape, or another Whot.
//  A player who takes a pick penalty loses their turn (the rival plays next).
//  Winning   The first player to play their last card wins at once, with any card ("check up"). A player holding one card is on "last card" (shown to both players).
//  Stalemate If the market and discard pile together cannot supply a draw (every card is in a hand), the game ends: the lower hand wins, counting the face number of each
//            card, stars double and Whot 20. Equal hands draw. (This can practically never happen; it exists so a game can never get stuck.)
import { RuleError, need } from "./errors.js";

export const info = { id: "WHOT", name: "Whot", blurb: "Match the shape or number, use the power cards and be first to play out your hand.", icon: "cards", turnSeconds: 45, seats: 2 };

export const SHAPES = ["circle", "triangle", "cross", "square", "star"];
export const SHAPE_LABEL = { circle: "Circle", triangle: "Triangle", cross: "Cross", square: "Square", star: "Star", whot: "Whot" };
export const HAND_SIZE = 6;
const RUN = [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14], FEW = [1, 2, 3, 5, 7, 10, 11, 13, 14];
const NUMBERS = { circle: RUN, triangle: RUN, cross: FEW, square: FEW, star: [1, 2, 3, 4, 5, 7, 8] };
export const POWER = { 1: "Hold on", 2: "Pick two", 5: "Pick three", 8: "Suspension", 14: "General market" };

/** The 54 cards, each { id, s: shape, n: number } with a fixed id so a move can name a card exactly. */
export function buildDeck() {
  const deck = []; let id = 0;
  for (const s of SHAPES) for (const n of NUMBERS[s]) deck.push({ id: id++, s, n });
  for (let i = 0; i < 5; i++) deck.push({ id: id++, s: "whot", n: 20 });
  return deck;
}
export const isPower = (c) => c.s !== "whot" && Object.hasOwn(POWER, c.n);
export const cardName = (c) => (c.s === "whot" ? "Whot" : `${SHAPE_LABEL[c.s]} ${c.n}`);
/** What a card is worth when the game is decided on hand size (stars count double). */
export const cardPoints = (c) => (c.s === "star" ? c.n * 2 : c.n);
export const handPoints = (hand) => hand.reduce((t, c) => t + cardPoints(c), 0);

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const top = (st) => st.discard[st.discard.length - 1];

export function create(rng) {
  const deck = shuffle(buildDeck(), rng), hands = [[], []];
  for (let i = 0; i < HAND_SIZE; i++) for (const seat of [0, 1]) hands[seat].push(deck.pop());
  const k = deck.findLastIndex((c) => c.s !== "whot" && !isPower(c)); // the starter is a plain card
  const [start] = deck.splice(k, 1);
  const turn = rng() < 0.5 ? 0 : 1;
  return { turn, first: turn, hands, market: deck, discard: [start], want: null, pending: null, moves: 0, done: false, last: null, log: [] };
}
export const turnOf = (st) => st.turn;

/** Can this card be played right now? (the whole rule of matching, in one place) */
export function canPlay(st, c) {
  if (st.pending) return c.s !== "whot" && c.n === st.pending.n; // only the same pick card answers a pick
  if (c.s === "whot") return true;
  if (st.want) return c.s === st.want;
  const t = top(st);
  return c.s === t.s || c.n === t.n;
}
/** Ids of the cards `seat` may play now. */
export const playable = (st, seat) => (st.done || st.turn !== seat ? [] : st.hands[seat].filter((c) => canPlay(st, c)).map((c) => c.id));

const copy = (st) => ({ ...st, hands: st.hands.map((h) => [...h]), market: [...st.market], discard: [...st.discard], log: [...st.log], pending: st.pending ? { ...st.pending } : null });
const note = (st, text) => { st.log.push(text); if (st.log.length > 10) st.log.shift(); };

/** Takes up to k cards from the market, turning the discard pile over when the market is empty. May return fewer than k only when every card is in a hand. */
function takeCards(st, k, rng) {
  const got = [];
  while (got.length < k) {
    if (!st.market.length) {
      if (st.discard.length <= 1) break;
      const keep = st.discard.pop();
      st.market = shuffle(st.discard, rng); st.discard = [keep];
      note(st, "The market ran out and was refilled from the discard pile.");
    }
    got.push(st.market.pop());
  }
  return got;
}

function stalemate(st, seat, event) {
  const a = handPoints(st.hands[0]), b = handPoints(st.hands[1]);
  st.done = true; st.last = event;
  const winner = a === b ? null : a < b ? 0 : 1, reason = `The market ran out. Lowest hand wins: ${a} to ${b}.`;
  note(st, reason);
  return { state: st, over: { winner, reason } };
}

/** { type: "play", card: id, shape? } (shape is required for a Whot card) or { type: "draw" }. `ctx.rng()` shuffles a refilled market. */
export function act(state, seat, action, ctx = {}) {
  need(!state.done, "The game is over.");
  need(seat === state.turn, "It is not your turn.");
  const rng = ctx.rng ?? Math.random, st = copy(state), me = st.hands[seat], foe = 1 - seat;

  if (action?.type === "play") {
    const id = Number(action.card); need(Number.isInteger(id), "Pick a card to play.");
    const i = me.findIndex((c) => c.id === id); need(i >= 0, "That card is not in your hand.");
    const card = me[i];
    if (!canPlay(state, card)) {
      need(false, state.pending ? `Answer with a ${state.pending.n}, or go to market and pick ${state.pending.count}.`
        : state.want ? `You must play ${SHAPE_LABEL[state.want]} (or a Whot card).` : "That card matches neither the shape nor the number.");
    }
    if (card.s === "whot") need(SHAPES.includes(action.shape), "Choose the shape you want played next.");
    me.splice(i, 1); st.discard.push(card); st.want = null; st.moves++;
    const ev = { seat, type: "play", card, effect: null, shape: null };
    let again = false, dry = false;
    if (card.s === "whot") { st.want = action.shape; ev.shape = action.shape; ev.effect = "whot"; note(st, `Seat ${seat} played Whot and asked for ${SHAPE_LABEL[action.shape]}.`); }
    else {
      note(st, `Seat ${seat} played ${cardName(card)}.`);
      if (card.n === 1) { again = true; ev.effect = "hold"; }
      else if (card.n === 8) { again = true; ev.effect = "suspend"; note(st, `Seat ${foe} misses a turn.`); }
      else if (card.n === 2 || card.n === 5) {
        st.pending = { n: card.n, count: (st.pending?.count ?? 0) + (card.n === 2 ? 2 : 3) }; ev.effect = "pick"; ev.count = st.pending.count;
        note(st, `Seat ${foe} must pick ${st.pending.count}, or answer with a ${card.n}.`);
      } else if (card.n === 14) {
        const got = takeCards(st, 1, rng); st.hands[foe].push(...got); again = true; ev.effect = "market"; ev.count = got.length;
        note(st, `General market: Seat ${foe} picks ${got.length}.`);
        dry = got.length < 1;
      }
    }
    st.last = ev;
    if (me.length === 0) { st.done = true; note(st, `Seat ${seat} played their last card.`); return { state: st, over: { winner: seat, reason: "Played their last card: check up!" } }; }
    if (dry) return stalemate(st, seat, ev); // the rival could not pick: nothing left to draw
    if (me.length === 1) note(st, `Seat ${seat} is on last card.`);
    st.turn = again ? seat : foe;
    return { state: st, over: null };
  }

  if (action?.type === "draw") {
    const pend = st.pending;
    if (!pend) need(playable(state, seat).length === 0, "You have a card you can play. The market is only for when you cannot.");
    const k = pend ? pend.count : 1, got = takeCards(st, k, rng);
    me.push(...got); st.pending = null; st.moves++;
    const ev = { seat, type: "draw", count: got.length, forced: !!pend };
    note(st, pend ? `Seat ${seat} picked ${got.length}.` : `Seat ${seat} went to market.`);
    if (got.length < k) return stalemate(st, seat, ev);
    st.last = ev; st.turn = foe; // picking (or going to market) ends the turn
    return { state: st, over: null };
  }
  throw new RuleError("Play a card or go to market.");
}

/** What `seat` is allowed to see: their own hand, the rival's card count (their hand only once the game is over), and what they may do. */
export function view(state, seat) {
  const mine = state.hands[seat], ok = playable(state, seat), yours = state.turn === seat && !state.done;
  return {
    seat, turn: state.turn, hand: mine, counts: state.hands.map((h) => h.length), market: state.market.length, discard: state.discard.length, top: top(state),
    want: state.want, pending: state.pending ? { n: state.pending.n, count: state.pending.count } : null, playable: ok,
    canDraw: yours && (!!state.pending || ok.length === 0), last: state.last, log: state.log, moves: state.moves, done: state.done,
    opponentHand: state.done ? state.hands[1 - seat] : null,
  };
}

// ------------------------------------------------------------------------------------------------ the computer player
const bestShape = (rest, rng) => {
  const n = Object.fromEntries(SHAPES.map((s) => [s, 0])); for (const c of rest) if (c.s !== "whot") n[c.s]++;
  const most = Math.max(...Object.values(n)), pool = SHAPES.filter((s) => n[s] === most);
  return pool[Math.floor(rng() * pool.length)];
};
/** A legal move for `seat` (it only ever returns what act() accepts). Plays to go out, answers picks, presses power cards when the rival is close to winning, and saves Whot cards. */
export function chooseMove(state, seat, rng = Math.random) {
  const hand = state.hands[seat], ok = hand.filter((c) => canPlay(state, c));
  if (!ok.length) return { type: "draw" };
  const foeCards = state.hands[1 - seat].length;
  let best = null;
  for (const c of ok) {
    const rest = hand.filter((x) => x.id !== c.id);
    let s = rng() * 0.3;
    if (!rest.length) s += 100;
    else if (c.s === "whot") s += rest.length <= 2 ? 4 : -4; // a Whot is the best card to keep until it is needed
    else {
      s += c.n === 14 ? 3.2 : c.n === 5 ? 3 : c.n === 2 ? 2.6 : c.n === 1 || c.n === 8 ? 2 : c.n / 10;
      if (foeCards <= 2 && (c.n === 2 || c.n === 5 || c.n === 14)) s += 3;
      s += rest.filter((x) => x.s === c.s).length * 0.4; // keep the chain going
    }
    if (!best || s > best.s) best = { s, c, rest };
  }
  const move = { type: "play", card: best.c.id };
  if (best.c.s === "whot") move.shape = bestShape(best.rest, rng);
  return move;
}

/** Test and tooling helpers. */
export const _t = { shuffle, takeCards };
