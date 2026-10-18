// lib/lectureIncident.js
// The N-QRS response that is running for a player right now, if any, for the state answer (so a screen that reconnects half way through
// can pick the sequence up at the right moment). Kept apart from lectureService.js so gameService.js can use it without a circular import.
import { incidentView } from "./lectureResponse.js";

/** The player's response that has not finished yet, as the screens see it, or null. `now` is the server's clock (ms). */
export async function activeIncident(db, characterId, now) {
  if (!db.lectureEncounter) return null; // databases that predate the table (older tests) simply have none
  const row = await db.lectureEncounter.findFirst({ where: { characterId, status: "SETTLED", responseEndsAt: { gt: new Date(now) } }, orderBy: { id: "desc" } });
  return incidentView(row, now);
}