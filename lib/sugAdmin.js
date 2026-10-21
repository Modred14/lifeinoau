// lib/sugAdmin.js
// Election ADMINISTRATION, kept apart from the political roles: only a User with role ADMIN (set from the server, scripts/make-admin.js) gets here, through
// requireAdmin(), and holding an office (President, Speaker...) never counts. An administrator can run the calendar (start or cancel an election, trigger the
// count) and disqualify a candidate BEFORE voting opens, with a written reason in the audit log. There is deliberately NO way to change a ballot, a vote
// total, a result or an appointment: ballots and results are append-only in the database, and the count is computed from the ballots.
import { serverNow } from "./clock.js";
import { AdminError } from "./admin.js";
import { createCycle, advance, cycleView, notify } from "./sugService.js";
import { cleanText } from "./rules.js";
import { GameError } from "./gameService.js";
import * as R from "./sugRules.js";

const audit = (db, actorId, action, target, detail) => db.auditLog.create({ data: { actorId, action, target: target ?? null, detail: detail ?? null } });
/** The election services throw GameError; the admin routes answer AdminError. */
const asGame = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof GameError) throw new AdminError(e.message, e.status); throw e; } };

/** Every cycle, newest first, with how many candidates and ballots it has (counts only: never who voted for whom). */
export async function overview(db) {
  const now = serverNow(); await advance(db, now);
  const cycles = await db.sugCycle.findMany({ orderBy: { number: "desc" }, take: 10 });
  const out = [];
  for (const c of cycles) {
    const [cands, ballots] = await Promise.all([db.sugCandidate.count({ where: { cycleId: c.id } }), db.sugBallot.count({ where: { cycleId: c.id } })]);
    out.push({ ...cycleView(c, now), candidates: cands, ballots });
  }
  // who is standing in the running election, for disqualification: names and posts only, never anything about votes
  const live = cycles.find((c) => c.status === "LIVE"), standing = live ? await db.sugCandidate.findMany({ where: { cycleId: live.id, status: "ACTIVE" }, orderBy: { id: "asc" } }) : [];
  const names = new Map((await db.character.findMany({ where: { id: { in: standing.map((x) => x.characterId) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  return { serverNow: now, cycles: out, standing: standing.map((x) => ({ id: x.id, name: names.get(x.characterId) ?? "Student", position: x.position, title: R.titleOf(x.position) })), positions: R.POSITIONS.map((p) => ({ key: p.key, title: p.title, seats: p.seats })), totalSeats: R.TOTAL_ELECTED_SEATS };
}

/** Start an election now (only when none is running). Without dates it uses the standard timetable; with them it checks the order. */
export async function startElection(db, adminId, { title, timetable } = {}) {
  return asGame(async () => {
    const now = serverNow();
    const t = timetable && typeof timetable === "object" ? Object.fromEntries(["announcedAt", "registrationOpensAt", "campaignStartsAt", "votingStartsAt", "votingEndsAt", "termStartsAt", "termEndsAt"].map((k) => [k, Date.parse(timetable[k])])) : null;
    if (t && Object.values(t).some((v) => !Number.isFinite(v))) throw new AdminError("Every date in the timetable must be a valid date.");
    const cycle = await createCycle(db, { announceAt: now, timetable: t, createdBy: adminId, title: cleanText(title, 80) || null });
    await audit(db, adminId, "SUG_START_ELECTION", String(cycle.id), { number: cycle.number, custom: !!t });
    return { ok: true, id: cycle.id, number: cycle.number };
  });
}

/** Cancel a running election that has not been decided. Its candidates keep their fee (it is a money sink); results never existed, so nothing is lost. */
export async function cancelElection(db, adminId, { id, reason } = {}) {
  const why = cleanText(reason, 300); if (why.length < 10) throw new AdminError("A clear reason (10+ characters) is required.");
  const cycle = await db.sugCycle.findUnique({ where: { id: Number(id) } });
  if (!cycle) throw new AdminError("No such election.", 404);
  if (cycle.status !== "LIVE" || cycle.resultsAt) throw new AdminError("Only a running election that has not been decided can be cancelled.", 409);
  await db.sugCycle.update({ where: { id: cycle.id }, data: { status: "CANCELLED", stage: "CANCELLED" } });
  const cands = await db.sugCandidate.findMany({ where: { cycleId: cycle.id, status: "ACTIVE" }, select: { characterId: true } });
  await notify(db, cands.map((c) => c.characterId), `🗳️ ${cycle.title} was cancelled by the administrators.`);
  await audit(db, adminId, "SUG_CANCEL_ELECTION", String(cycle.id), { reason: why });
  return { ok: true };
}

/** Disqualify a candidate. Only until voting opens (afterwards ballots already cast would be wasted), and always with a reason. */
export async function disqualify(db, adminId, { candidateId, reason } = {}) {
  const why = cleanText(reason, 300); if (why.length < 10) throw new AdminError("A clear reason (10+ characters) is required.");
  const cand = await db.sugCandidate.findUnique({ where: { id: Number(candidateId) }, include: { race: { include: { cycle: true } } } });
  if (!cand) throw new AdminError("No such candidate.", 404);
  const cycle = cand.race.cycle, now = serverNow();
  if (cycle.status !== "LIVE" || cycle.resultsAt) throw new AdminError("That election is over.", 409);
  if (now >= +cycle.votingStartsAt) throw new AdminError("Voting has begun. A candidate can no longer be disqualified.", 409);
  if (cand.status !== "ACTIVE") throw new AdminError("That candidate is not standing.", 409);
  await db.sugCandidate.update({ where: { id: cand.id }, data: { status: "DISQUALIFIED", statusNote: why } });
  await notify(db, [cand.characterId], `🗳️ You were disqualified from the ${cycle.title} race: ${why}`);
  await audit(db, adminId, "SUG_DISQUALIFY", String(cand.id), { reason: why, position: cand.position, characterId: cand.characterId });
  return { ok: true };
}

/** Run the clock-driven work now (count the votes if voting is over). It changes nothing that would not happen by itself. */
export async function runNow(db, adminId) {
  const c = await advance(db, serverNow()); await audit(db, adminId, "SUG_ADVANCE", c ? String(c.id) : null, null);
  return { ok: true, stage: c?.stage ?? null };
}