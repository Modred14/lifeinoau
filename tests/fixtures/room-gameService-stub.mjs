// Minimal player-action guard for roomService tests. Production roomService still uses gameService.loadLocked.
export class GameError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export async function loadLocked(tx, userId) {
  const character = await tx.character.findUnique({ where: { userId }, include: { account: true } });
  if (!character) throw new GameError("Create a character first.", 404);
  return character;
}
