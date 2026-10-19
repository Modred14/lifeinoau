// lib/hustleService.js: the Oduduwa Hall event crew and the SUB backstairs runs.
// Everything is decided here, in one transaction with the player's row locked:
//  - start: you must be AT the building (your placeId on the server, set when you arrive on the map), awake, free, not on a job shift, not already on a run,
//    inside the same daily limits as before (safe: 2 a day, 6h apart; risky: 1 a day). The energy is taken and the outcome rolled now and stored.
//  - finish: only after the run has lasted its time, only while you are still at the building, only once (ACTIVE -> DONE flips in the same step that pays).
//  - leaving the building during a run (travel) abandons it: the attempt and the energy are gone, nothing is paid.
import { loadLocked, GameError, start, needReq, sanction, hustleToday } from "./gameService.js";
import { transferInTx } from "./ledger.js";
import { isJailed, custodyFields, CUSTODY_PLACE } from "./discipline.js";
import { hustleBlock, arrestStats, bailFor, riskyJailMinutes, seizureFor, waitText, HUSTLE } from "./engine.js";
import { placeOf } from "./travel.js";
import { roll } from "./rng.js";
import { SITES, beginRun, siteOfPlace, riskWord, siteRules, runMs } from "./hustleSites.js";

const now = () => Date.now();
const s = (n) => n.toString();

async function view(db, c, kind) {
  const site = SITES[kind], t = now(), [run, st] = await Promise.all([db.hustleRun.findFirst({ where: { characterId: c.id, status: "ACTIVE" } }), hustleToday(db, c.id, null)]);
  const rules = siteRules(kind), here = placeOf(c) === site.place;
  const block = isJailed(c, t) ? "You are in N-QRS custody." : c.sleepingSince ? "You are asleep." : !here ? `You have to be at ${site.where}.` : hustleBlock(site.hustle, st, t);
  return { kind, name: site.name, where: site.where, desk: site.desk, blurb: site.blurb, atSite: here, serverNow: t, energy: rules.energy, durationSeconds: runMs(kind) / 1000, durationMs: runMs(kind),
    payMin: rules.min, payMax: rules.max, perDay: rules.perDay, left: kind === "crew" ? st.safeLeft : st.riskyLeft, gapHours: kind === "crew" ? rules.gapMs / 3_600_000 : null, resetsAt: st.resetsAt,
    nextAt: kind === "crew" ? Math.max(st.safeGapEndsAt ?? 0, st.safeLeft > 0 ? 0 : st.resetsAt) || null : (st.riskyLeft > 0 ? null : st.resetsAt),
    risk: kind === "backstairs" ? riskWord(c) : null, blocked: run ? null : block,
    run: run && { id: s(run.id), kind: run.kind, startedAt: +run.startedAt, endsAt: +run.endsAt, here: placeOf(c) === run.placeId, done: t >= +run.endsAt } };
}

/** The panel at the building: the rules, your limits right now, and the run in progress (if any). Read only. */
export async function getSite(db, userId, kind) {
  if (!SITES[kind]) throw new GameError("Unknown activity.", 404);
  await start(db, userId);
  const c = await db.character.findUnique({ where: { userId } });
  return view(db, c, kind);
}

export async function startRun(db, userId, { kind, requestId }) {
  needReq(requestId); const site = SITES[kind]; if (!site) throw new GameError("Unknown activity.", 404);
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { awake: true }), t = now();
      if (placeOf(c) !== site.place) throw new GameError(`You have to be at ${site.where} for this.`, 403);
      if (await tx.hustleRun.findFirst({ where: { characterId: c.id, status: "ACTIVE" } })) throw new GameError("You are already in the middle of a run.", 409);
      if (await tx.jobShift.findFirst({ where: { characterId: c.id, status: "ACTIVE" } })) throw new GameError("You are on a job shift. Finish it first.", 409);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: site.log, gameWeek: week, createdAt: new Date(t) } }); // P2002 on replay; counts toward the daily limits
      const why = hustleBlock(site.hustle, await hustleToday(tx, c.id, requestId), t); if (why) throw new GameError(why, 429);
      const r = beginRun(c, kind, t, roll); if (r.error) throw new GameError(r.error, 409);
      await tx.hustleRun.create({ data: { characterId: c.id, kind, placeId: site.place, startedAt: new Date(t), endsAt: new Date(r.endsAtMs), energyCost: r.energyCost, caught: r.caught, payKobo: r.payKobo, requestId } });
      await tx.character.update({ where: { id: c.id }, data: r.stats });
      return { ok: true, kind, startedAt: t, endsAt: r.endsAtMs, energy: r.energyCost, role: r.role ?? null };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}

export async function finishRun(db, userId, { requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { awake: true }), t = now();
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "hustlefinish", gameWeek: week } }); // P2002 on replay
      const run = await tx.hustleRun.findFirst({ where: { characterId: c.id, status: "ACTIVE" } });
      if (!run) throw new GameError("You are not on a run.", 409);
      if (t < +run.endsAt) throw new GameError(`Not done yet. ${waitText(+run.endsAt - t)} to go.`, 409);
      if (placeOf(c) !== run.placeId) { await tx.hustleRun.updateMany({ where: { id: run.id, status: "ACTIVE" }, data: { status: "ABANDONED", finishedAt: new Date(t) } }); return { ok: true, abandoned: true, note: "You left before it was over, so there is no pay." }; }
      const flipped = await tx.hustleRun.updateMany({ where: { id: run.id, status: "ACTIVE" }, data: { status: "DONE", finishedAt: new Date(t) } });
      if (flipped.count !== 1) return { ok: true, duplicate: true };
      const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
      if (!run.caught) {
        await transferInTx(tx, { fromId: world.id, toId: c.account.id, amount: run.payKobo, memo: run.kind === "crew" ? "Event crew, Oduduwa Hall" : "Backstairs run", key: `hustle:${run.id}`, week });
        return { ok: true, kind: run.kind, caught: false, earnedKobo: s(run.payKobo) };
      }
      // N-QRS: the same seizure, sentence, bail and strike as ever
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${c.account.id} FOR UPDATE`;
      const acc = await tx.account.findUnique({ where: { id: c.account.id } }), dsa = await tx.account.findUnique({ where: { systemName: "DSA" } });
      const seized = seizureFor(acc.balance);
      if (seized > 0n) await transferInTx(tx, { fromId: acc.id, toId: dsa.id, amount: seized, memo: "QRS seizure", key: `seize:${c.id}:${run.id}`, week });
      const releaseAt = new Date(t + riskyJailMinutes(roll) * 60_000), bill = bailFor(releaseAt, t), sn = sanction(c.strikes + 1, t);
      // served INSIDE Floor O (N-QRS Custody), exactly like every other arrest: the custody record, the player moved there, the strike
      await tx.floorZero.create({ data: { characterId: c.id, reason: "Backstairs run, SUB", startedAt: new Date(t), releaseAt, bill, location: CUSTODY_PLACE } });
      await tx.character.update({ where: { id: c.id }, data: { ...arrestStats(c), ...custodyFields(t, releaseAt), ...sn } });
      return { ok: true, kind: run.kind, caught: true, seizedKobo: s(seized), billKobo: s(bill), releaseAt, strikes: sn.strikes, suspended: !!sn.suspendedUntil, expelled: !!sn.expelled };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}

/** Walk away from a run: the attempt and the energy are spent, nothing is paid. */
export async function abandonRun(db, userId, { requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true });
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "hustleabandon", gameWeek: week } });
      const r = await tx.hustleRun.updateMany({ where: { characterId: c.id, status: "ACTIVE" }, data: { status: "ABANDONED", finishedAt: new Date(now()) } });
      return { ok: true, abandoned: r.count };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}