// lib/fightService.js: fighting a lecturer in their lecture room, and what comes after. Rules live in lib/fight.js, the lecture room and the encounter
// in lib/lectureService.js, and the N-QRS response timeline in lib/lectureResponse.js.
import { loadLocked, GameError, start, needReq, sanction } from "./gameService.js";
import { coursesFor } from "./curriculum.js";
import { resolveFight } from "./fight.js";
import { bailFor, seizureFor, jailMinutes } from "./engine.js";
import { transferInTx } from "./ledger.js";
import { serverNow } from "./clock.js";
import { custodyFields, CUSTODY_PLACE } from "./discipline.js";
import { claimEncounter, incidentOfRequest } from "./lectureService.js";
import { responseFields, incidentView } from "./lectureResponse.js";
import { roll } from "./rng.js";

/**
 * One fight per week: even a champion needs the weekend to cool off. The fight must be about an OPEN encounter the player started by walking up to the
 * lecturer in their lecture room (startEncounter), so there is no way to fight a lecturer from anywhere else.
 *
 *   lost                  you were beaten: nobody is in danger and nobody comes
 *   won, slipped away     the lecturer is down: N-QRS comes and rescues them, finds nobody to arrest, and leaves
 *   won, caught (70%)     N-QRS comes, rescues the lecturer and APPREHENDS YOU: cash seized, a bill, a strike and a sentence served inside Floor O
 *
 * The arrest and the custody are written in this one transaction (so no refresh, second tab or lost connection can undo or repeat them); the response the
 * screens act out is a timeline from this moment (lib/lectureResponse.js). The lecturer is never the one arrested.
 */
export async function doFight(db, userId, { code, report, requestId, encounterId } = {}) {
  needReq(requestId); const week = await start(db, userId);
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  // A fight that was already recorded (the answer was lost on the way, a tab was refreshed, or two taps arrived together): hand back what it produced.
  // This is checked before the locked checks on purpose: a player who was arrested by this very fight is in custody now and would otherwise be refused
  // ("you are in Floor O") instead of being told the outcome. It is checked again if the transaction fails, because a request that lost the race to an
  // identical one meets the first one's arrest when it gets the lock.
  const recorded = async () => {
    if (!base || encounterId == null || !(await db.actionLog.findFirst({ where: { characterId: base.id, requestId } }))) return null;
    const was = await incidentOfRequest(db, base.id, encounterId);
    return was ? { ok: true, duplicate: true, ...replayOf(was.row, was.view) } : null;
  };
  { const done = await recorded(); if (done) return done; }
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "fight", gameWeek: week } }); // P2002 on replay
      if ((await tx.actionLog.count({ where: { characterId: c.id, action: "fight", gameWeek: week } })) > 1) throw new GameError("You already fought a lecturer this week. Let things cool down.", 409);
      const now = serverNow();
      const enc = await claimEncounter(tx, c, { encounterId, code, now });
      const course = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)).find((x) => x.code === code);
      if (!course) throw new GameError("That is not one of your courses.", 404);
      const r = resolveFight(c, report, roll); if (r.error) throw new GameError(r.error);
      const lecturer = course.lecturer.name;
      if (!r.won) {
        await tx.character.update({ where: { id: c.id }, data: r.stats });
        const done = await tx.lectureEncounter.update({ where: { id: enc.id }, data: { status: "SETTLED", outcome: "LOST", ...responseFields("LOST", now) } });
        return { ok: true, won: false, caught: false, lecturer, incident: incidentView(done, now) };
      }
      if (!r.caught) {
        await tx.character.update({ where: { id: c.id }, data: r.stats });
        const done = await tx.lectureEncounter.update({ where: { id: enc.id }, data: { status: "SETTLED", outcome: "ESCAPED", ...responseFields("ESCAPED", now) } });
        return { ok: true, won: true, caught: false, lecturer, incident: incidentView(done, now) };
      }
      // N-QRS caught the player. Same consequences as any other arrest: they seize cash, you get a bill and a sentence, and a strike.
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${c.account.id} FOR UPDATE`; // freeze cash while we compute the seizure
      const acc = await tx.account.findUnique({ where: { id: c.account.id } });
      const dsa = await tx.account.findUnique({ where: { systemName: "DSA" } });
      const seized = seizureFor(acc.balance);
      if (seized > 0n) await transferInTx(tx, { fromId: acc.id, toId: dsa.id, amount: seized, memo: "QRS seizure", key: `seize:${c.id}:${requestId}`, week });
      const releaseAt = new Date(now + jailMinutes(roll) * 60_000), bill = bailFor(releaseAt, now), s = sanction(c.strikes + 1, now);
      const fz = await tx.floorZero.create({ data: { characterId: c.id, reason: `Beat up ${lecturer}`, startedAt: new Date(now), releaseAt, bill, location: CUSTODY_PLACE } });
      await tx.character.update({ where: { id: c.id }, data: { ...r.stats, ...custodyFields(now, releaseAt), ...s } }); // served inside Floor O (N-QRS Custody)
      const result = { seizedKobo: seized.toString(), billKobo: bill.toString(), releaseAt, strikes: s.strikes, suspended: !!s.suspendedUntil, expelled: !!s.expelled };
      const done = await tx.lectureEncounter.update({ where: { id: enc.id }, data: { status: "SETTLED", outcome: "ARRESTED", floorZeroId: fz?.id ?? null, result, ...responseFields("ARRESTED", now) } });
      return { ok: true, won: true, caught: true, lecturer, ...result, incident: incidentView(done, now) };
    });
  } catch (e) {
    if (/one_active_lecture_response/.test(String(e.meta?.target ?? e.message ?? ""))) throw new GameError("N-QRS is already at the scene, securing the lecturer.", 409); // another response started in this room a moment ago
    if (e.code === "P2002" || e instanceof GameError) { const done = await recorded(); if (done) return done; }
    if (e.code === "P2002") return { ok: true, duplicate: true };
    throw e;
  }
}

/** The answer to a fight that was already recorded, rebuilt from the encounter row. */
function replayOf(row, view) {
  return { won: row.outcome !== "LOST", caught: row.outcome === "ARRESTED", lecturer: row.lecturerName, ...(row.result ?? {}), incident: view };
}