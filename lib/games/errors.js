// lib/games/errors.js
// What a game engine throws when a move is not allowed. The match service turns it into a plain 4xx answer; nothing changes when it is thrown.
export class RuleError extends Error {
  constructor(message, status = 409) { super(message); this.name = "RuleError"; this.status = status; }
}
/** Throws a RuleError unless `cond` holds. */
export const need = (cond, message, status = 409) => { if (!cond) throw new RuleError(message, status); };
