// lib/games/practice.js
// Practice against the computer, for any game. Nothing is at stake and nothing is saved: the game runs in the browser on the same rules engine (lib/games/<game>.js) a live match uses,
// and the computer is the same AI player (lib/games/ai.js) that fills in for a missing opponent. It only ever plays moves the engine accepts. Pure: no React, no database, no clock of its own
// beyond the `now` it is given, so the screen (components/games/BotPractice.js) and the tests drive it the same way.
// You are seat 0; the computer is seat 1.
import { ENGINES } from "./index.js";
import { botAction, thinkMs, legalActions, pickBot, hashSeed } from "./ai.js";
import { need } from "./errors.js";

export const YOU = 0, BOT = 1;
export const canPractice = (game) => typeof game === "string" && Object.hasOwn(ENGINES, game);

/** A fresh game against a random persona (not `avoidBotId`, so "Play again" is not always the same opponent). `rng` is Math.random in the app. */
export function newPractice(game, rng = Math.random, avoidBotId = null) {
  need(canPractice(game), "That game cannot be practised.");
  const bot = pickBot(rng, avoidBotId);
  return { game, bot, state: ENGINES[game].create(rng), version: 0, over: null, seed: Math.floor(rng() * 2 ** 31) };
}

export const turnSeat = (p) => ENGINES[p.game].turnOf(p.state);
export const isYourTurn = (p) => !p.over && turnSeat(p) === YOU;
export const isBotTurn = (p) => !p.over && turnSeat(p) === BOT;

function play(p, seat, action, ctx) {
  const version = p.version + 1, r = ENGINES[p.game].act(p.state, seat, action, { rng: ctx.rng ?? Math.random, now: ctx.now ?? Date.now(), version });
  return { ...p, state: r.state, version, over: r.over ?? null };
}

/** Your move. Throws a RuleError (with a plain message) when the game does not allow it; the game is left as it was. */
export function playerMove(p, action, ctx = {}) {
  need(!p.over, "The game is over.");
  return play(p, YOU, action, ctx);
}

/** The computer's move: its own choice, or (should that ever be refused) the first legal move there is, so a game can never stall. */
export function botMove(p, ctx = {}) {
  need(isBotTurn(p), "It is not the computer's turn.");
  const seed = hashSeed(p.seed, p.version);
  try { return play(p, BOT, botAction(p.game, p.state, BOT, p.bot, seed, { budgetMs: ctx.budgetMs }), ctx); } catch { /* fall through to a legal move */ }
  for (const a of legalActions(p.game, p.state, BOT, ctx.rng ?? Math.random)) { try { return play(p, BOT, a, ctx); } catch { /* try the next */ } }
  throw new Error("The computer has no legal move.");
}

/** How long (ms) the computer takes before it plays: a person's pace for that game, plus the time your own shot or its flight takes to be watched. */
export function botDelay(p) {
  const seed = hashSeed(p.seed, p.version);
  let ms = thinkMs(p.game, p.state, BOT, p.bot, seed, ENGINES[p.game].info.turnSeconds);
  const last = p.state.last;
  if (p.game === "POOL" && last?.frames) ms += last.frames.length * 50 + 500; // let your shot finish rolling first
  if (p.game === "HOOPS" && p.state.phase === "pick" && last) ms += 1800;       // let your ball land first
  return ms;
}

/** Give up. */
export const resign = (p) => (p.over ? p : { ...p, version: p.version + 1, over: { winner: BOT, reason: "You resigned." } });

/** What the result card says: [headline, tone, reason]. */
export function resultText(p) {
  const w = p.over?.winner, tone = w === YOU ? "win" : w === BOT ? "lose" : "draw";
  const reason = String(p.over?.reason ?? "").replace(/Seat 0/g, "You").replace(/Seat 1/g, "The computer").replace(/\btheir\b/g, w === YOU ? "your" : "its");
  return [tone === "win" ? "You won!" : tone === "lose" ? "The computer won" : "Draw", tone, reason];
}
