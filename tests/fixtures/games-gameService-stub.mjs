// tests/fixtures/games-gameService-stub.mjs: stands in for lib/gameService.js in the games match test. Same rules as the real loadLocked for the cases the games use:
// no character -> 404, expelled -> 403, suspended -> 403, in custody -> refused unless the caller allows it.
import { isExpelled, isSuspended, isJailed } from "../../lib/discipline.js";
export class GameError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
export async function loadLocked(tx, userId, { allowJailed = false, allowSuspended = false } = {}) {
  const c = await tx.character.findUnique({ where: { userId }, include: { account: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  const now = Date.now();
  if (isExpelled(c, now)) throw new GameError("expelled", 403);
  if (isSuspended(c, now) && !allowSuspended) throw new GameError("suspended", 403);
  if (isJailed(c, now) && !allowJailed) throw new GameError("custody", 403);
  return c;
}
