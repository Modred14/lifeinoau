// tests/fixtures/wardrobe-gameService-stub.mjs: stands in for lib/gameService.js in tests/wardrobe.test.mjs (same rules as the real helpers for the cases the store uses).
export class GameError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
export function needReq(id) { if (typeof id !== "string" || id.length < 8) throw new GameError("Missing request id.", 400); }
export async function start(db, userId) { const c = await db.character.findUnique({ where: { userId } }); if (!c) throw new GameError("Create a character first.", 404); return 1; }
export async function loadLocked(tx, userId) {
  const c = await tx.character.findUnique({ where: { userId }, include: { account: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  return c;
}
