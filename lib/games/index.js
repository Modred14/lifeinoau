// lib/games/index.js
// Every playable game, in one place, and the rules about money that apply to all of them. Pure data and pure functions: the browser, the server and the
// tests all read this file. To add a game: write its engine (see lib/games/ludo.js for the shape), register it here, and give it a board component.
import * as chess from "./chess.js";
import * as ludo from "./ludo.js";
import * as pool from "./pool.js";
import * as hoops from "./hoops.js";
import * as connect4 from "./connect4.js";
import * as checkers from "./checkers.js";
import * as tictactoe from "./tictactoe.js";
import * as whot from "./whot.js";

export const ENGINES = { LUDO: ludo, CHESS: chess, POOL: pool, HOOPS: hoops, CHECKERS: checkers, CONNECT4: connect4, TICTACTOE: tictactoe, WHOT: whot };
/** The games in the order the Games app shows them. */
export const GAME_IDS = ["LUDO", "CHESS", "POOL", "HOOPS", "CHECKERS", "CONNECT4", "TICTACTOE", "WHOT"];
export const GAME_LIST = GAME_IDS.map((id) => ({ id, name: ENGINES[id].info.name, blurb: ENGINES[id].info.blurb, icon: ENGINES[id].info.icon, turnSeconds: ENGINES[id].info.turnSeconds }));
export const isGame = (id) => typeof id === "string" && Object.hasOwn(ENGINES, id);

// ------------------------------------------------------------------------------------------------ money rules
/** Wagers are whole naira. 0 is a friendly game (nothing at stake). */
export const STAKE_CHOICES = [0, 100, 500, 1_000, 2_000, 5_000, 10_000, 25_000, 50_000];
export const MIN_STAKE_NAIRA = 100, MAX_STAKE_NAIRA = 100_000;
/** The prize pool is exactly what both players put in: the winner takes all of it, there is no house cut. */
export const poolOf = (stakeKobo) => BigInt(stakeKobo) * 2n;
/** A wager typed or tapped by a player, as whole naira, or null if it is not allowed. */
export function cleanStake(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_STAKE_NAIRA) return null;
  if (n !== 0 && n < MIN_STAKE_NAIRA) return null;
  return n;
}

// ------------------------------------------------------------------------------------------------ timing (all in ms, all measured by the server)
export const INVITE_MS = 10 * 60_000;      // a challenge nobody answers lapses (nothing was held, so nothing is returned)
export const QUEUE_MS = 10 * 60_000;       // a search for a random opponent is dropped after this long
export const REMATCH_MS = 90_000;          // how long a rematch request waits for an answer
export const MATCH_HARD_CAP_MS = 12 * 3_600_000; // an unfinished match older than this is voided and every stake is returned
/** Players in custody may play (and wager). Set to false to keep detainees to free games only. */
export const WAGERS_IN_CUSTODY = true;

export const RESULT = { WIN: "WIN", DRAW: "DRAW", FORFEIT: "FORFEIT", TIMEOUT: "TIMEOUT", VOID: "VOID", CANCELLED: "CANCELLED" };
