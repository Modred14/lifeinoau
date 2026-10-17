// lib/fightService.js: fighting a lecturer, and what comes after. Rules live in lib/fight.js.
import { loadLocked, GameError, start, needReq, sanction } from "./gameService.js";
import { coursesFor } from "./curriculum.js";
import { resolveFight } from "./fight.js";
import { bailFor, seizureFor, jailMinutes } from "./engine.js";
import { transferInTx } from "./ledger.js";
import { roll } from "./rng.js";

/** One fight per week: even a champion needs the weekend to cool off. */
export async function doFight(db, userId, { code, report, requestId } = {}) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "fight", gameWeek: week } }); // P2002 on replay
      if ((await tx.actionLog.count({ where: { characterId: c.id, action: "fight", gameWeek: week } })) > 1) throw new GameError("You already fought a lecturer this week. Let things cool down.", 409);
      const course = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)).find((x) => x.code === code);
      if (!course) throw new GameError("That is not one of your courses.", 404);
      const r = resolveFight(c, report, roll); if (r.error) throw new GameError(r.error);
      const lecturer = course.lecturer.name;
      if (!r.won || !r.caught) {
        await tx.character.update({ where: { id: c.id }, data: r.stats });
        return { ok: true, won: r.won, caught: false, lecturer };
      }
      // The QRS van came. Same consequences as any other arrest: the QRS seizes cash, you get a bill and a sentence, and a strike.
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${c.account.id} FOR UPDATE`; // freeze cash while we compute the seizure
      const acc = await tx.account.findUnique({ where: { id: c.account.id } });
      const dsa = await tx.account.findUnique({ where: { systemName: "DSA" } });
      const seized = seizureFor(acc.balance);
      if (seized > 0n) await transferInTx(tx, { fromId: acc.id, toId: dsa.id, amount: seized, memo: "QRS seizure", key: `seize:${c.id}:${requestId}`, week });
      const now = Date.now(), releaseAt = new Date(now + jailMinutes(roll) * 60_000), bill = bailFor(releaseAt, now), s = sanction(c.strikes + 1, week);
      await tx.floorZero.create({ data: { characterId: c.id, reason: `Beat up ${lecturer}`, releaseAt, bill } });
      await tx.character.update({ where: { id: c.id }, data: { ...r.stats, jailedUntil: releaseAt, ...s } });
      return { ok: true, won: true, caught: true, lecturer, seizedKobo: seized.toString(), billKobo: bill.toString(), releaseAt, strikes: s.strikes, suspended: !!s.suspendedUntilWeek, expelled: s.expelled };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}