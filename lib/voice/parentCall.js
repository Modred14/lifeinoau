// lib/voice/parentCall.js  (server only)
// Ties a voice turn to a real call home: the call must exist, be yours, have been answered, and be recent. The outcome and gift in the prompt come from the
// stored PhoneCall row (decided and paid by lib/callService.js callParent), never from anything the browser says.
import { GameError } from "../gameService.js";
import { isAnsweredOutcome } from "../callRules.js";
import { parentPrompt, VOICE_LIMITS } from "./persona.js";

/** Returns { call, system } for this player's answered call home, or throws a GameError (404 for anything that is not theirs or not a call home). */
export async function loadParentCall(db, userId, callId, now = Date.now()) {
  const id = String(callId ?? "");
  if (!/^[\w-]{8,40}$/.test(id)) throw new GameError("That call was not found.", 404);
  const me = await db.character.findUnique({ where: { userId }, select: { id: true, name: true, class: true, level: true, missedCallStreak: true } });
  if (!me) throw new GameError("Create a character first.", 404);
  const call = await db.phoneCall.findUnique({ where: { id } });
  if (!call || call.kind !== "PARENT" || call.callerId !== me.id) throw new GameError("That call was not found.", 404);
  if (!isAnsweredOutcome(call.outcome) || !call.answeredAt) throw new GameError("Nobody picked up on that call.", 409);
  if (now - new Date(call.answeredAt).getTime() > VOICE_LIMITS.maxCallMs + 120_000) throw new GameError("That call is over. Call again.", 410);
  const system = parentPrompt({ parent: call.calleeName, outcome: call.outcome, giftKobo: call.paidKobo ?? 0n, player: { name: me.name, cls: me.class, level: me.level, missedStreak: me.missedCallStreak } });
  return { call, me, system, parent: call.calleeName };
}
