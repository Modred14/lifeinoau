// lib/sugService.js
// The SUG election: cycles, candidate registration, campaigning, money, voting, counting and results. The rules are in lib/sugRules.js (pure);
// everything here runs on the server and trusts nothing the browser sends: the player comes from the session, the stage from the clock, vote
// totals and winners from the ballots in the database. Integrity that must survive a bug in this file is also enforced by the database itself
// (see prisma/migrations/20261019000000_sug_elections): ballots and results are append-only, ballots and nominations are refused outside their
// windows, there is one ballot per voter per race per round, one office per person, 30 Honourable Member seats, and a spending cap per candidate.
import { serverNow, dayWindow } from "./clock.js";
import { loadLocked, GameError, needReq } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { currentWeek } from "./clock.js";
import { cleanText } from "./rules.js";
import { PRESENCE_MINUTES } from "./travel.js";
import * as R from "./sugRules.js";

export { GameError };
const str = (v) => (v == null ? null : v.toString());
const dateOrNull = (v) => (v == null ? null : new Date(v));

// ============================================================================================================================ helpers
/** A transaction-scoped advisory lock: the same key serialises everyone who asks for it, with no table row to lock. Released at commit. */
const lock = (tx, key) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

/** Wrap a database error raised by one of the migration's triggers into a message a player can read. */
function dbMessage(e) {
  const m = /(?:ballot|candidate|result|cycle|expense): ([^\n]+)/.exec(e?.message ?? "");
  return m ? m[1].replace(/\.$/, "") : null;
}
// Which unique key a P2002 came from. The shape of `meta` differs between Prisma engines, so look at all of it.
const targetHas = (e, name) => e?.code === "P2002" && JSON.stringify(e.meta ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).includes(name);

/** Notify these characters (kind SUG): one insert, however many. */
export async function notify(db, ids, body, kind = "SUG") {
  const to = [...new Set(ids)].filter(Boolean); if (!to.length) return;
  await db.notification.createMany({ data: to.map((characterId) => ({ characterId, kind, body })) });
}

/** Record that this request was processed, FIRST in the transaction: if the very same request arrives again it hits the unique key and is answered as a harmless duplicate
 *  before any state check can object to it. If the action then fails, the transaction rolls back and the request id is free to be used again. */
export const claim = (tx, characterId, requestId, action) => currentWeek(tx).then((gameWeek) => tx.actionLog.create({ data: { characterId, requestId, action, gameWeek } }));

async function sugAccount(tx) { const a = await tx.account.findUnique({ where: { systemName: "SUG" } }); if (!a) throw new GameError("The SUG account is missing: run the migrations.", 500); return a; }

const publicOf = (c) => ({ name: c.name, gender: c.gender, level: c.level, faculty: c.faculty?.name ?? "", look: c.look ?? null });
const CHAR_PUBLIC = { id: true, name: true, gender: true, level: true, look: true, faculty: { select: { name: true } } };

// ============================================================================================================================ cycles
/** The cycle that is running (LIVE), or null. */
export const liveCycle = (db) => db.sugCycle.findFirst({ where: { status: "LIVE" } });

/**
 * Starts the next election when it is due, so the game never needs a manual database change to hold future elections:
 *  - no election has ever been held: one is announced now;
 *  - the last one was decided: the next is announced early enough that its government takes over exactly when the old term ends;
 *  - the last one was cancelled: the next starts once the cancelled timetable would have been over (an admin can start one sooner).
 * Two requests at once are safe: only one cycle can be LIVE (partial unique index), the other gets the winner's.
 */
export async function ensureCycle(db, now = serverNow()) {
  const live = await liveCycle(db); if (live) return live;
  const last = await db.sugCycle.findFirst({ orderBy: { number: "desc" } });
  if (last) {
    if (last.status === "DECIDED" && now < +last.termEndsAt - R.leadMs()) return null;
    if (last.status === "CANCELLED" && now < +last.votingEndsAt) return null;
  }
  try { return await createCycle(db, { announceAt: now, createdBy: "SYSTEM" }); } catch (e) { if (e?.code === "P2002" || /one_live_sug_cycle|already/.test(e?.message ?? "")) return liveCycle(db); throw e; }
}

/** Creates a cycle and its 12 races. `timetable` may override the default dates (admin). Throws a GameError when the dates are wrong. */
export async function createCycle(db, { announceAt = serverNow(), timetable = null, createdBy = "SYSTEM", title = null, money = {} } = {}) {
  return db.$transaction(async (tx) => {
    await lock(tx, "sug:cycle");
    if (await tx.sugCycle.findFirst({ where: { status: "LIVE" } })) throw new GameError("An election is already running. Cancel it first, or wait for it to finish.", 409);
    const last = await tx.sugCycle.findFirst({ orderBy: { number: "desc" } });
    const notBefore = last && last.status === "DECIDED" ? +last.termEndsAt : 0;
    const t = timetable ?? R.defaultTimetable(announceAt, { notBefore });
    const bad = timetable ? R.timetableProblem(t) : null; if (bad) throw new GameError(bad);
    if (timetable && last && last.status === "DECIDED" && t.termStartsAt < +last.termEndsAt) throw new GameError("The new term cannot start before the current government's term ends.");
    const number = (last?.number ?? 0) + 1, m = { ...R.MONEY, ...money };
    const cycle = await tx.sugCycle.create({ data: {
      number, title: title || `SUG Election ${number}`, status: "LIVE", stage: R.stageOf({ ...t, status: "LIVE", resultsAt: null }, announceAt),
      announcedAt: new Date(t.announcedAt), registrationOpensAt: new Date(t.registrationOpensAt), campaignStartsAt: new Date(t.campaignStartsAt), votingStartsAt: new Date(t.votingStartsAt),
      votingEndsAt: new Date(t.votingEndsAt), termStartsAt: new Date(t.termStartsAt), termEndsAt: new Date(t.termEndsAt),
      nominationFeeKobo: BigInt(m.nominationFeeKobo), spendCapExecKobo: BigInt(m.spendCapExecKobo), spendCapAssemblyKobo: BigInt(m.spendCapAssemblyKobo), createdBy } });
    await tx.sugRace.createMany({ data: R.POSITIONS.map((p) => ({ cycleId: cycle.id, position: p.key, seats: p.seats })) });
    return cycle;
  });
}

/**
 * An automatic election that was announced before the fixed calendar existed (R.ELECTION_SCHEDULE) carries an hour-based timetable. While its voting has
 * not begun, move it onto the calendar (registration closes 25 Oct 2026 at 23:59:59 game time, voting opens 27 Oct 2026 at 00:00), so the stored dates, the
 * server's checks and the database triggers all use the one schedule. Idempotent; it never touches a cycle whose voting has begun, one with a runoff or results,
 * an election an administrator started with dates of their own, or a run that uses SUG_TIME_SCALE. (The migration 20261023000000_sug_election_schedule does the same in SQL.)
 */
async function alignToSchedule(db, cycle, now) {
  if (!cycle || cycle.status !== "LIVE" || cycle.createdBy !== "SYSTEM" || cycle.resultsAt != null || cycle.runoffStartsAt != null) return cycle;
  if (now >= +cycle.votingStartsAt || now >= R.ELECTION_SCHEDULE.votingStartsAt || R.onSchedule(cycle)) return cycle;
  if (R.defaultTimetable(+cycle.announcedAt).votingStartsAt !== R.ELECTION_SCHEDULE.votingStartsAt) return cycle; // SUG_TIME_SCALE is set: demo timetable
  const t = R.scheduledTimetable(+cycle.announcedAt), data = {
    announcedAt: new Date(t.announcedAt), registrationOpensAt: new Date(t.registrationOpensAt), campaignStartsAt: new Date(t.campaignStartsAt), votingStartsAt: new Date(t.votingStartsAt),
    votingEndsAt: new Date(t.votingEndsAt), termStartsAt: new Date(t.termStartsAt), termEndsAt: new Date(t.termEndsAt), stage: R.stageOf({ ...t, status: "LIVE", resultsAt: null }, now),
  };
  // the database trigger sug_cycle_lock refuses a voting-window change once voting has begun, so the filter below and the trigger agree
  const done = await db.sugCycle.updateMany({ where: { id: cycle.id, status: "LIVE", resultsAt: null, runoffStartsAt: null, votingStartsAt: { gt: new Date(now) } }, data });
  return done.count ? { ...cycle, ...data } : cycle;
}

/** Brings everything that depends on the clock up to date: counting after voting ends, finished campaign events, the stage label, the term's status. Safe to call on every request. */
export async function advance(db, now = serverNow()) {
  let cycle = await alignToSchedule(db, await ensureCycle(db, now), now);
  if (cycle && cycle.status === "LIVE" && cycle.resultsAt == null && now >= +cycle.votingEndsAt) { await tally(db, cycle.id, now); cycle = await db.sugCycle.findUnique({ where: { id: cycle.id } }); }
  if (cycle) {
    const stage = R.stageOf(cycle, now);
    if (stage !== cycle.stage) { await db.sugCycle.updateMany({ where: { id: cycle.id, stage: { not: stage } }, data: { stage } }); cycle = { ...cycle, stage }; }
  }
  await settleDueEvents(db, now);
  const at = new Date(now);
  await db.sugTerm.updateMany({ where: { status: "SCHEDULED", startsAt: { lte: at } }, data: { status: "ACTIVE" } });
  await db.sugTerm.updateMany({ where: { status: { in: ["SCHEDULED", "ACTIVE"] }, endsAt: { lte: at } }, data: { status: "ENDED" } });
  return cycle;
}

// ============================================================================================================================ counting
const parseTie = (race) => { try { const j = JSON.parse(race.tieNote ?? "null"); return j && Array.isArray(j.ids) ? j : null; } catch { return null; } };

/**
 * Counts a cycle once voting has ended. Idempotent and safe under concurrency (one counter at a time, results written once):
 *  1. count round-one ballots for the candidates still standing;
 *  2. if a tie decides a seat, open a runoff for just those candidates (once) and wait for it to end;
 *  3. write the final rows, lock the results, create the term and the offices of the winners.
 */
export async function tally(db, cycleId, now = serverNow()) {
  try {
    return await db.$transaction(async (tx) => {
      await lock(tx, `sug:tally:${cycleId}`);
      const cycle = await tx.sugCycle.findUnique({ where: { id: cycleId } });
      if (!cycle || cycle.status !== "LIVE" || cycle.resultsAt != null || now < +cycle.votingEndsAt) return { done: false };
      const races = await tx.sugRace.findMany({ where: { cycleId }, include: { candidates: { where: { status: "ACTIVE" } } }, orderBy: { id: "asc" } });
      const counts = await tx.sugBallot.groupBy({ by: ["candidateId", "round"], where: { cycleId }, _count: { _all: true } });
      const votes = (round) => new Map(counts.filter((c) => c.round === round).map((c) => [c.candidateId, c._count._all]));
      const r1 = votes(1), r2 = votes(2);
      const firsts = new Map(races.map((r) => [r.id, R.countRound(r.candidates.map((c) => ({ id: c.id, votes: r1.get(c.id) ?? 0, registeredAt: c.registeredAt })), r.seats)]));

      // 2. ties: open the runoff once
      const tied = races.filter((r) => firsts.get(r.id).tie);
      if (tied.length && cycle.runoffStartsAt == null) {
        const start = Math.max(+cycle.votingEndsAt, now), end = start + R.runoffMs();
        const shift = Math.max(0, end - +cycle.termStartsAt); // a late count pushes the term back rather than breaking the timetable
        await tx.sugCycle.update({ where: { id: cycleId }, data: { runoffStartsAt: new Date(start), runoffEndsAt: new Date(end), ...(shift ? { termStartsAt: new Date(+cycle.termStartsAt + shift), termEndsAt: new Date(+cycle.termEndsAt + shift) } : {}) } });
        for (const r of tied) await tx.sugRace.update({ where: { id: r.id }, data: { status: "RUNOFF", tieNote: JSON.stringify(firsts.get(r.id).tie) } });
        return { done: false, runoff: true };
      }
      if (tied.length && now < +cycle.runoffEndsAt) return { done: false, runoff: true };

      // 3. final rows
      const candidates = new Map(races.flatMap((r) => r.candidates.map((c) => [c.id, c])));
      const winners = [];
      for (const r of races) {
        const first = firsts.get(r.id);
        const cs = r.candidates.map((c) => ({ id: c.id, votes: r1.get(c.id) ?? 0, registeredAt: c.registeredAt }));
        let runoff = null;
        if (first.tie) { const v = new Map(first.tie.ids.map((id) => [id, r2.get(id) ?? 0])); runoff = { votes: v, result: R.settleRunoff(first.tie.ids.map((id) => cs.find((c) => c.id === id)), first.tie.seats, v) }; }
        const rows = R.finalRows(cs, first, runoff);
        if (rows.length) await tx.sugResult.createMany({ data: rows.map((x) => ({ cycleId, raceId: r.id, candidateId: x.id, votes: x.votes, runoffVotes: x.runoffVotes, percentBp: x.percentBp, rank: x.rank, outcome: x.outcome, seat: x.seat, tieBreak: x.tieBreak })) });
        for (const x of rows) await tx.sugCandidate.update({ where: { id: x.id }, data: { status: x.won ? "WON" : "LOST" } });
        const won = rows.filter((x) => x.won);
        await tx.sugRace.update({ where: { id: r.id }, data: { status: "CLOSED", validVotes: first.total, seatsFilled: won.length, tieNote: first.tie ? (runoff.result.brokenByRegistration ? "RUNOFF_THEN_REGISTRATION_ORDER" : "RUNOFF") : null } });
        for (const x of won) winners.push({ race: r, candidate: candidates.get(x.id), seat: x.seat });
      }
      // lock the results, then form the government (the term's offices are created now; they only carry powers once the term begins)
      const final = await tx.sugCycle.findUnique({ where: { id: cycleId } });
      await tx.sugCycle.update({ where: { id: cycleId }, data: { resultsAt: new Date(now), status: "DECIDED", stage: "RESULTS" } });
      const term = await tx.sugTerm.create({ data: { cycleId, startsAt: final.termStartsAt, endsAt: final.termEndsAt, status: +final.termStartsAt <= now ? "ACTIVE" : "SCHEDULED" } });
      if (winners.length) await tx.sugAppointment.createMany({ data: winners.map((w) => ({ termId: term.id, characterId: w.candidate.characterId, position: w.race.position, seat: w.seat, kind: "ELECTED" })) });
      const won = new Set(winners.map((w) => w.candidate.id));
      if (winners.length) await tx.notification.createMany({ data: winners.map((w) => ({ characterId: w.candidate.characterId, kind: "SUG", body: `🗳️ You won! You were elected ${R.titleOf(w.race.position)} in ${cycle.title}. Your term begins ${R.gameWhen(+final.termStartsAt)} (game time).` })) });
      await notify(tx, [...candidates.values()].filter((c) => !won.has(c.id)).map((c) => c.characterId), `🗳️ The results of ${cycle.title} are out. Open the SUG app to see how you did.`);
      return { done: true, winners: winners.length };
    }, { timeout: 60_000 });
  } catch (e) {
    if (e?.code === "P2002" || e?.code === "P2034") return { done: false, raced: true }; // someone else counted first, or the transaction conflicted: the next call sees the result
    throw e;
  }
}

// ============================================================================================================================ reading
/** The timetable as the screens show it. */
function timetableOf(c) {
  const d = (x) => (x == null ? null : +new Date(x));
  return { announcedAt: d(c.announcedAt), registrationOpensAt: d(c.registrationOpensAt), campaignStartsAt: d(c.campaignStartsAt), votingStartsAt: d(c.votingStartsAt), votingEndsAt: d(c.votingEndsAt), runoffStartsAt: d(c.runoffStartsAt), runoffEndsAt: d(c.runoffEndsAt), resultsAt: d(c.resultsAt), termStartsAt: d(c.termStartsAt), termEndsAt: d(c.termEndsAt) };
}
/** What the next change of stage is and when, for the countdown. */
function nextChange(c, stage, now) {
  const t = timetableOf(c);
  const next = { ANNOUNCED: ["Registration opens", t.registrationOpensAt], REGISTRATION: ["Registration closes", t.campaignStartsAt], CAMPAIGN: ["Voting opens", t.votingStartsAt], VOTING: ["Voting closes", t.votingEndsAt],
    RUNOFF: ["Runoff closes", t.runoffEndsAt], RESULTS: c.resultsAt ? ["Government takes office", t.termStartsAt] : ["Results are announced", t.votingEndsAt], FORMATION: ["Government takes office", t.termStartsAt], ACTIVE: ["Term ends", t.termEndsAt] }[stage];
  return next ? { label: next[0], at: next[1] } : null;
}

export function cycleView(c, now) {
  const stage = R.stageOf(c, now);
  return { id: c.id, number: c.number, title: c.title, status: c.status, stage, stageLabel: R.STAGE_INFO[stage].label, stageHint: R.STAGE_INFO[stage].can, timetable: timetableOf(c), next: nextChange(c, stage, now),
    nominationFeeKobo: str(c.nominationFeeKobo), spendCapExecKobo: str(c.spendCapExecKobo), spendCapAssemblyKobo: str(c.spendCapAssemblyKobo), resultsFinal: c.resultsAt != null };
}

async function myCharacter(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, include: { account: true, faculty: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  return c;
}

/** The home screen of the SUG app: the election's state and what THIS player can do in it. No ballot is ever returned. */
export async function getSug(db, userId) {
  const now = serverNow(); let cycle = await advance(db, now);
  const c = await myCharacter(db, userId);
  const out = { serverNow: now, cycle: null, me: { name: c.name, voterIssues: R.voterIssues(c, now), candidateIssues: R.candidateIssues(c, now), candidacy: null, voted: {}, canRegister: false }, races: [], config: { events: R.EVENT_KINDS, venues: R.CAMPAIGN_VENUES, limits: R.LIMITS, dailyMomentumCap: R.DAILY_MOMENTUM_CAP } };
  if (!cycle) { // between elections: say when the next one starts
    const last = await db.sugCycle.findFirst({ orderBy: { number: "desc" } });
    out.next = last && last.status === "DECIDED" ? { announceAt: +last.termEndsAt - R.leadMs() } : null;
    return out;
  }
  const view = cycleView(cycle, now); out.cycle = view;
  const [races, mine, ballots, turnout, cands] = await Promise.all([
    db.sugRace.findMany({ where: { cycleId: cycle.id }, orderBy: { id: "asc" } }),
    db.sugCandidate.findFirst({ where: { cycleId: cycle.id, characterId: c.id } }),
    db.sugBallot.findMany({ where: { cycleId: cycle.id, voterId: c.id }, select: { raceId: true, round: true } }),
    db.sugBallot.groupBy({ by: ["raceId", "round"], where: { cycleId: cycle.id }, _count: { _all: true } }),
    db.sugCandidate.groupBy({ by: ["raceId"], where: { cycleId: cycle.id, status: { in: ["ACTIVE", "WON", "LOST"] } }, _count: { _all: true } }),
  ]);
  const round = R.openRound(cycle, now), cn = new Map(cands.map((x) => [x.raceId, x._count._all])), tn = new Map(turnout.map((x) => [`${x.raceId}:${x.round}`, x._count._all]));
  out.races = races.map((r) => {
    const p = R.positionOf(r.position), tie = parseTie(r);
    return { position: r.position, title: p.title, short: p.short, group: p.group, seats: r.seats, about: p.about, status: r.status, candidates: cn.get(r.id) ?? 0, ballots: tn.get(`${r.id}:1`) ?? 0, runoffBallots: tn.get(`${r.id}:2`) ?? 0, seatsFilled: r.seatsFilled,
      voted: ballots.some((b) => b.raceId === r.id && b.round === 1), votedRunoff: ballots.some((b) => b.raceId === r.id && b.round === 2), inRunoff: !!tie && r.status === "RUNOFF", mine: mine?.raceId === r.id };
  });
  if (mine) out.me.candidacy = { id: mine.id, position: mine.position, title: R.titleOf(mine.position), status: mine.status, slogan: mine.slogan };
  const open = R.registrationOpen(cycle, now);
  out.me.canRegister = open && !mine && out.me.candidateIssues.length === 0;
  out.me.registerWhy = !open ? (view.stage === "ANNOUNCED" ? "Registration has not opened yet." : "Registration is closed.") : mine ? (mine.status === "WITHDRAWN" ? "You withdrew from this election and cannot register again in this cycle." : `You are already standing for ${R.titleOf(mine.position)}. You can stand for one position per election.`) : out.me.candidateIssues[0] ?? null;
  out.me.votingOpen = round > 0; out.me.round = round;
  out.me.mayVote = out.me.voterIssues.length === 0;
  return out;
}

/** Public candidate profiles of one race, with how far their campaign has reached. */
export async function getCandidates(db, userId, position, { cycleId } = {}) {
  const now = serverNow(); await advance(db, now); const me = await myCharacter(db, userId);
  if (!R.isElectedPosition(position)) throw new GameError("No such position.", 404);
  const cycle = cycleId ? await db.sugCycle.findUnique({ where: { id: Number(cycleId) } }) : (await liveCycle(db)) ?? (await db.sugCycle.findFirst({ orderBy: { number: "desc" } }));
  if (!cycle) throw new GameError("There is no election yet.", 404);
  const race = await db.sugRace.findUnique({ where: { cycleId_position: { cycleId: cycle.id, position } } });
  const resultsOut = cycle.resultsAt != null;
  const cs = await db.sugCandidate.findMany({ where: { raceId: race.id, status: { in: resultsOut ? ["ACTIVE", "WON", "LOST"] : ["ACTIVE"] } }, orderBy: { registeredAt: "asc" } });
  const ids = cs.map((c) => c.id);
  const [chars, momentum, support, spent, events, mine] = await Promise.all([
    db.character.findMany({ where: { id: { in: cs.map((c) => c.characterId) } }, select: CHAR_PUBLIC }),
    db.sugCampaignEvent.groupBy({ by: ["candidateId"], where: { candidateId: { in: ids }, status: "SUCCESS" }, _sum: { momentum: true }, _count: { _all: true } }),
    db.sugSupport.groupBy({ by: ["candidateId", "pledged"], where: { candidateId: { in: ids } }, _count: { _all: true } }),
    db.sugExpense.groupBy({ by: ["candidateId"], where: { candidateId: { in: ids } }, _sum: { amountKobo: true } }),
    db.sugCampaignEvent.findMany({ where: { candidateId: { in: ids } }, orderBy: { id: "desc" }, take: 60, select: { id: true, candidateId: true, kind: true, title: true, venue: true, status: true, startsAt: true, endsAt: true, attendees: true, note: true } }),
    db.sugSupport.findMany({ where: { supporterId: me.id, pledged: true, candidateId: { in: ids } }, select: { candidateId: true } }),
  ]);
  const byId = new Map(chars.map((c) => [c.id, c])), cap = R.capFor(cycle, position);
  const tie = parseTie(race);
  return { race: { position, title: R.titleOf(position), seats: race.seats, status: race.status, round: R.openRound(cycle, now), tieIds: tie?.ids ?? null }, resultsOut,
    candidates: cs.map((c) => {
      const m = momentum.find((x) => x.candidateId === c.id), sup = support.filter((x) => x.candidateId === c.id), sp = spent.find((x) => x.candidateId === c.id)?._sum.amountKobo ?? 0n;
      const supporters = sup.reduce((n, x) => n + x._count._all, 0), pledged = sup.filter((x) => x.pledged).reduce((n, x) => n + x._count._all, 0);
      return { id: c.id, position, status: c.status, slogan: c.slogan, intro: c.intro, manifesto: c.manifesto, promises: c.promises, registeredAt: c.registeredAt, isMe: c.characterId === me.id,
        who: publicOf(byId.get(c.characterId) ?? { name: "Student", gender: "M" }), spentKobo: str(sp), capKobo: str(cap), supporters, pledged,
        strength: R.strengthOf({ eventMomentum: m?._sum.momentum ?? 0, supporters, pledged, spentKobo: sp, capKobo: cap }), eventsHeld: m?._count._all ?? 0,
        events: events.filter((e) => e.candidateId === c.id).slice(0, 5).map((e) => ({ ...e, id: e.id.toString() })), iPledged: mine.some((x) => x.candidateId === c.id) };
    }) };
}

// ============================================================================================================================ registration
const asList = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : []);

/** Standing for office. One position per player per cycle; the fee is paid on the ledger in the same transaction. */
export async function register(db, userId, { position, slogan, intro, manifesto, promises, requestId } = {}) {
  needReq(requestId);
  if (!R.isElectedPosition(position)) throw new GameError("Choose a position to stand for.");
  const s = cleanText(slogan, R.LIMITS.slogan), i = cleanText(intro, R.LIMITS.intro), m = String(manifesto ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, R.LIMITS.manifesto);
  const pr = asList(promises).map((x) => cleanText(x, R.LIMITS.promise)).filter(Boolean).slice(0, R.LIMITS.promises);
  if (s.length < 3) throw new GameError("Write a campaign slogan (at least 3 characters).");
  if (i.length < 10) throw new GameError("Introduce yourself to the students (at least 10 characters).");
  if (m.length < 30) throw new GameError("Your manifesto is too short. Tell students what you will do (at least 30 characters).");
  if (!pr.length || pr.some((x) => x.length < 3)) throw new GameError("Add at least one campaign promise.");
  const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), cycle = await tx.sugCycle.findFirst({ where: { status: "LIVE" } });
      await claim(tx, c.id, requestId, "sug:register");
      if (!cycle) throw new GameError("There is no election to stand in right now.", 409);
      if (!R.registrationOpen(cycle, now)) throw new GameError(now < +cycle.registrationOpensAt ? "Registration has not opened yet." : "Registration is closed. You can no longer register for this election.", 409);
      const bad = R.candidateIssues(c, now); if (bad.length) throw new GameError(bad.join(" "), 403);
      const had = await tx.sugCandidate.findUnique({ where: { cycleId_characterId: { cycleId: cycle.id, characterId: c.id } } });
      if (had) throw new GameError(had.status === "WITHDRAWN" ? "You withdrew from this election and cannot register again in this cycle." : `You are already standing for ${R.titleOf(had.position)}. You can stand for one position per election.`, 409);
      const race = await tx.sugRace.findUnique({ where: { cycleId_position: { cycleId: cycle.id, position } } });
      const fee = BigInt(cycle.nominationFeeKobo);
      if (fee > 0n) await transferInTx(tx, { fromId: c.account.id, toId: (await sugAccount(tx)).id, amount: fee, memo: `SUG nomination fee (${R.titleOf(position)})`, key: `sug:fee:${cycle.id}:${c.id}`, week: await currentWeek(tx) });
      const cand = await tx.sugCandidate.create({ data: { cycleId: cycle.id, raceId: race.id, characterId: c.id, position, slogan: s, intro: i, manifesto: m, promises: pr, feeKobo: fee } });
      return { ok: true, candidateId: cand.id, position, title: R.titleOf(position), feeKobo: fee.toString() };
    });
  } catch (e) {
    if (targetHas(e, "requestId")) return { ok: true, duplicate: true };
    if (targetHas(e, "characterId") && targetHas(e, "cycleId")) throw new GameError("You are already registered in this election. You can stand for one position per election.", 409);
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford the nomination fee.", 402);
    const m2 = dbMessage(e); if (m2) throw new GameError(/registration/.test(m2) ? "Registration is closed. You can no longer register for this election." : m2, 409);
    throw e;
  }
}

/** Pull out before voting begins. The fee is not refunded and the same player cannot register again in this cycle. */
export async function withdraw(db, userId, { requestId } = {}) {
  needReq(requestId); const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowSuspended: true }), cycle = await tx.sugCycle.findFirst({ where: { status: "LIVE" } });
      await claim(tx, c.id, requestId, "sug:withdraw");
      const cand = cycle && await tx.sugCandidate.findUnique({ where: { cycleId_characterId: { cycleId: cycle.id, characterId: c.id } } });
      if (!cand || cand.status !== "ACTIVE") throw new GameError("You are not standing in this election.", 409);
      if (now >= +cycle.votingStartsAt) throw new GameError("Voting has begun, so you can no longer withdraw. Your name stays on the ballot.", 409);
      await tx.sugCandidate.update({ where: { id: cand.id }, data: { status: "WITHDRAWN", statusNote: "Withdrew" } });
      return { ok: true };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; const m = dbMessage(e); if (m) throw new GameError(m, 409); throw e; }
}

// ============================================================================================================================ voting
/**
 * Cast the ballot of THIS player (from the session) for a candidate in a race. Every rule is checked here against the database and the clock, and again by
 * the database itself: the window, the candidate being in that race, and one ballot per voter per race per round (a unique key, so two requests
 * at once cannot both succeed). A player may vote in the race they stand in. The answer never says who anyone else voted for.
 */
export async function vote(db, userId, { position, candidateId, requestId } = {}) {
  needReq(requestId);
  if (!R.isElectedPosition(position)) throw new GameError("No such position.", 404);
  const cid = Number(candidateId); if (!Number.isInteger(cid) || cid < 1) throw new GameError("Choose a candidate.");
  const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), cycle = await tx.sugCycle.findFirst({ where: { status: "LIVE" } });
      await claim(tx, c.id, requestId, "sug:vote");
      if (!cycle) throw new GameError("There is no election right now.", 409);
      const round = R.openRound(cycle, now);
      if (!round) throw new GameError(now < +cycle.votingStartsAt ? "Voting has not started yet." : "Voting is over.", 409);
      const bad = R.voterIssues(c, now); if (bad.length) throw new GameError(bad.join(" "), 403);
      const race = await tx.sugRace.findUnique({ where: { cycleId_position: { cycleId: cycle.id, position } } });
      const cand = await tx.sugCandidate.findUnique({ where: { id: cid } });
      if (!cand || cand.raceId !== race.id || cand.status !== "ACTIVE") throw new GameError("That candidate is not standing for this position.", 404);
      if (round === 2) {
        const tie = parseTie(race);
        if (race.status !== "RUNOFF" || !tie) throw new GameError("There is no runoff for this position.", 409);
        if (!tie.ids.includes(cand.id)) throw new GameError("That candidate is not in the runoff.", 409);
      } else if (race.status !== "OPEN") throw new GameError("Voting for this position is closed.", 409);
      if (await tx.sugBallot.findUnique({ where: { raceId_round_voterId: { raceId: race.id, round, voterId: c.id } } })) throw new GameError(round === 2 ? "You have already voted in this runoff." : "You have already voted for this position.", 409);
      await tx.sugBallot.create({ data: { cycleId: cycle.id, raceId: race.id, round, voterId: c.id, candidateId: cand.id } });
      return { ok: true, position, round };
    });
  } catch (e) {
    if (targetHas(e, "requestId")) return { ok: true, duplicate: true };
    if (targetHas(e, "voterId")) throw new GameError("You have already voted for this position.", 409);
    const m = dbMessage(e); if (m) throw new GameError(/not open|closed/.test(m) ? "Voting is not open." : m, 409);
    throw e;
  }
}

// ============================================================================================================================ results
/** Final results of the latest decided election (or `cycleId`), race by race. Nothing is shown until the results are final. */
export async function getResults(db, userId, { cycleId } = {}) {
  const now = serverNow(); await advance(db, now); await myCharacter(db, userId);
  const cycle = cycleId ? await db.sugCycle.findUnique({ where: { id: Number(cycleId) } }) : await db.sugCycle.findFirst({ where: { resultsAt: { not: null } }, orderBy: { number: "desc" } });
  if (!cycle || cycle.resultsAt == null) return { available: false, serverNow: now };
  const [races, results] = await Promise.all([db.sugRace.findMany({ where: { cycleId: cycle.id }, orderBy: { id: "asc" } }), db.sugResult.findMany({ where: { cycleId: cycle.id }, orderBy: [{ raceId: "asc" }, { rank: "asc" }, { id: "asc" }] })]);
  const cands = await db.sugCandidate.findMany({ where: { id: { in: results.map((r) => r.candidateId) } }, select: { id: true, characterId: true, slogan: true } });
  const chars = await db.character.findMany({ where: { id: { in: cands.map((c) => c.characterId) } }, select: CHAR_PUBLIC }), byChar = new Map(chars.map((c) => [c.id, c])), byCand = new Map(cands.map((c) => [c.id, c]));
  return { available: true, serverNow: now, cycle: { id: cycle.id, number: cycle.number, title: cycle.title, resultsAt: +cycle.resultsAt, termStartsAt: +cycle.termStartsAt, termEndsAt: +cycle.termEndsAt }, totalSeats: R.TOTAL_ELECTED_SEATS,
    races: races.map((r) => {
      const p = R.positionOf(r.position), rows = results.filter((x) => x.raceId === r.id);
      return { position: r.position, title: p.title, group: p.group, seats: r.seats, seatsFilled: r.seatsFilled, vacant: r.seats - r.seatsFilled, validVotes: r.validVotes, tieNote: r.tieNote,
        status: r.seatsFilled === 0 ? "No winner" : r.seatsFilled < r.seats ? `${r.seatsFilled} of ${r.seats} seats filled` : "Decided",
        rows: rows.map((x) => { const cand = byCand.get(x.candidateId); return { candidateId: x.candidateId, who: publicOf(byChar.get(cand?.characterId) ?? { name: "Student", gender: "M" }), slogan: cand?.slogan ?? "", votes: x.votes, runoffVotes: x.runoffVotes, percent: x.percentBp / 100, rank: x.rank, outcome: x.outcome, seat: x.seat, tieBreak: x.tieBreak }; }) };
    }) };
}

/** Winners of past elections, newest first (a short history for the dashboard). */
export async function getHistory(db, userId) {
  await myCharacter(db, userId);
  const cycles = await db.sugCycle.findMany({ where: { resultsAt: { not: null } }, orderBy: { number: "desc" }, take: 8 });
  const out = [];
  for (const cy of cycles) {
    const w = await db.sugResult.findMany({ where: { cycleId: cy.id, outcome: "WON", race: { position: { not: "HONOURABLE_MEMBER" } } }, include: { race: { select: { position: true } } }, orderBy: { raceId: "asc" } });
    const cs = await db.sugCandidate.findMany({ where: { id: { in: w.map((x) => x.candidateId) } }, select: { id: true, characterId: true } });
    const ch = new Map((await db.character.findMany({ where: { id: { in: cs.map((c) => c.characterId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const by = new Map(cs.map((c) => [c.id, ch.get(c.characterId)]));
    out.push({ id: cy.id, number: cy.number, title: cy.title, termStartsAt: +cy.termStartsAt, termEndsAt: +cy.termEndsAt, leaders: w.map((x) => ({ position: x.race.position, title: R.titleOf(x.race.position), name: by.get(x.candidateId) ?? "Student" })) });
  }
  return { cycles: out };
}

// ============================================================================================================================ campaigning
const fresh = (c, now) => c.placeId && c.placeAt && now - +c.placeAt <= PRESENCE_MINUTES * 60_000;
/** The candidate row of this player in the live cycle (ACTIVE only), or a clear refusal. */
async function myCandidacy(tx, c, now) {
  const cycle = await tx.sugCycle.findFirst({ where: { status: "LIVE" } });
  if (!cycle) throw new GameError("There is no election right now.", 409);
  const cand = await tx.sugCandidate.findUnique({ where: { cycleId_characterId: { cycleId: cycle.id, characterId: c.id } } });
  if (!cand || cand.status !== "ACTIVE") throw new GameError("Only candidates can campaign. Register while registration is open.", 403);
  return { cycle, cand };
}
const dayMomentum = async (tx, candidateId, dayStart) => (await tx.sugCampaignEvent.aggregate({ where: { candidateId, status: "SUCCESS", endsAt: { gte: new Date(dayStart) } }, _sum: { momentum: true } }))._sum.momentum ?? 0;

/**
 * Start a campaign activity. Live ones (speech, rally, meeting, debate) happen at a campus venue where the candidate is standing, last a few
 * minutes, and only count when other real players come (see settleDueEvents). The others (message, posters, publicity) happen at once.
 * Money goes through the ledger into the SUG account and is recorded as an expense, under the spending cap. Energy is spent. Limits per kind
 * (cooldown, per day) and the daily momentum cap stop anyone farming influence by repeating requests.
 */
export async function startEvent(db, userId, { kind, venue, title, body, opponentId, requestId } = {}) {
  needReq(requestId);
  const k = R.EVENT_KINDS[kind]; if (!k) throw new GameError("Unknown campaign activity.");
  const now = serverNow(); await advance(db, now);
  const t = cleanText(title, R.LIMITS.title), msg = cleanText(body, k.live ? R.LIMITS.speech : R.LIMITS.message);
  if (kind === "MESSAGE" && msg.length < 5) throw new GameError("Write the message first.");
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await claim(tx, c.id, requestId, "sug:event");
      const { cycle, cand } = await myCandidacy(tx, c, now);
      if (!R.campaignOpen(cycle, now)) throw new GameError(now < +cycle.campaignStartsAt ? "The campaign period has not started yet." : "The campaign is over.", 409);
      if (k.venue) {
        if (!R.CAMPAIGN_VENUES[venue]) throw new GameError("Choose a campus venue for this.");
        if (c.placeId !== venue || !fresh(c, now)) throw new GameError(`You must be at ${R.CAMPAIGN_VENUES[venue]} to do this. Travel there first.`, 409);
      }
      let opp = null;
      if (k.opponent) {
        const oid = Number(opponentId); if (!Number.isInteger(oid) || oid === cand.id) throw new GameError("Choose an opponent in your race to debate.");
        opp = await tx.sugCandidate.findUnique({ where: { id: oid } });
        if (!opp || opp.raceId !== cand.raceId || opp.status !== "ACTIVE") throw new GameError("You can only debate another candidate for the same position.");
      }
      if (c.energy < k.energy) throw new GameError(`You are too tired. This takes ${k.energy} energy.`, 409);
      const day = await dayWindow(tx, now);
      const [today, last, running] = await Promise.all([
        tx.sugCampaignEvent.count({ where: { candidateId: cand.id, kind, createdAt: { gte: new Date(day.start) } } }),
        tx.sugCampaignEvent.findFirst({ where: { candidateId: cand.id, kind }, orderBy: { id: "desc" }, select: { createdAt: true } }),
        k.live ? tx.sugCampaignEvent.findFirst({ where: { candidateId: cand.id, status: "LIVE", endsAt: { gt: new Date(now) } } }) : null,
      ]);
      if (running) throw new GameError("You are already in the middle of a campaign event. Finish it first.", 409);
      if (today >= k.dailyMax) throw new GameError(`You have done as many of these as you can today (${k.dailyMax}). Come back tomorrow.`, 429);
      if (last && now - +last.createdAt < k.cooldownMin * 60_000) throw new GameError(`Give it a rest. You can do this again in ${Math.ceil((k.cooldownMin * 60_000 - (now - +last.createdAt)) / 60_000)} minutes.`, 429);
      const week = await currentWeek(tx), cost = BigInt(k.costNaira) * 100n, endsAt = new Date(now + (k.live ? k.minutes * 60_000 : 0));
      const ev = await tx.sugCampaignEvent.create({ data: { cycleId: cycle.id, candidateId: cand.id, kind, venue: k.venue ? venue : null, title: t || k.label, body: msg, costKobo: cost, opponentId: opp?.id ?? null, startsAt: new Date(now), endsAt, requestId } });
      if (cost > 0n) {
        const key = `sug:exp:${cand.id}:${requestId}`;
        await transferInTx(tx, { fromId: c.account.id, toId: (await sugAccount(tx)).id, amount: cost, memo: `SUG campaign: ${k.label}`, key, week });
        await tx.sugExpense.create({ data: { cycleId: cycle.id, candidateId: cand.id, eventId: ev.id, kind, amountKobo: cost, ledgerKey: key, requestId } }); // the database refuses it past the spending cap
      }
      await tx.character.update({ where: { id: c.id }, data: { energy: { decrement: k.energy } } });
      if (opp) await notify(tx, [opp.characterId], `🎤 ${c.name} has challenged you to a debate at ${R.CAMPAIGN_VENUES[venue]} for the next ${k.minutes} minutes. Go there to accept.`);
      if (!k.live) { await settleOne(tx, ev, now); return { ok: true, eventId: ev.id.toString(), live: false, ...(await eventResult(tx, ev.id)), costKobo: cost.toString() }; }
      return { ok: true, eventId: ev.id.toString(), live: true, endsAt: +endsAt, venue, anim: k.anim, costKobo: cost.toString(), energy: k.energy };
    });
  } catch (e) {
    if (targetHas(e, "requestId")) return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402);
    const m = dbMessage(e); if (m) throw new GameError(/spending limit/.test(m) ? "That would take you over the campaign spending limit." : m, 409);
    throw e;
  }
}
const eventResult = async (tx, id) => { const e = await tx.sugCampaignEvent.findUnique({ where: { id } }); return { status: e.status, momentum: e.momentum, note: e.note }; };

/** A real player standing at the venue joins a live event: that is how they hear the speech or take part in the rally. */
export async function joinEvent(db, userId, { eventId } = {}) {
  const id = /^\d{1,15}$/.test(String(eventId ?? "")) ? BigInt(eventId) : null; if (!id) throw new GameError("No such event.", 404);
  const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), ev = await tx.sugCampaignEvent.findUnique({ where: { id }, include: { candidate: true } });
      if (!ev || ev.status !== "LIVE" || now >= +ev.endsAt) throw new GameError("That event is over.", 409);
      if (ev.candidate.characterId === c.id) throw new GameError("It is your own event.", 409);
      if (ev.venue && (c.placeId !== ev.venue || !fresh(c, now))) throw new GameError(`You need to be at ${R.CAMPAIGN_VENUES[ev.venue]} to join. Travel there first.`, 409);
      const isOpp = ev.opponentId != null && ev.opponentId !== ev.candidateId && (await tx.sugCandidate.findUnique({ where: { id: ev.opponentId } }))?.characterId === c.id;
      const bad = R.voterIssues(c, now); if (bad.length && !isOpp) throw new GameError(bad.join(" "), 403);
      await tx.sugEventAttendance.create({ data: { eventId: id, characterId: c.id } });
      return { ok: true, eventId: id.toString(), debate: isOpp, title: ev.title, endsAt: +ev.endsAt };
    });
  } catch (e) { if (targetHas(e, "characterId")) return { ok: true, duplicate: true, already: true }; throw e; }
}

/** Candidate invites other players by name to an event that is running. A few invites per event, never to someone who has blocked or been blocked. */
export async function inviteToEvent(db, userId, { eventId, names, requestId } = {}) {
  needReq(requestId);
  const id = /^\d{1,15}$/.test(String(eventId ?? "")) ? BigInt(eventId) : null; if (!id) throw new GameError("No such event.", 404);
  const list = [...new Set(asList(names).map((n) => cleanText(n, 40)).filter(Boolean))].slice(0, R.INVITES.perCall); if (!list.length) throw new GameError("Choose who to invite.");
  const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), ev = await tx.sugCampaignEvent.findUnique({ where: { id }, include: { candidate: true } });
      if (!ev || ev.candidate.characterId !== c.id) throw new GameError("That is not your event.", 404);
      if (ev.status !== "LIVE" || now >= +ev.endsAt) throw new GameError("That event is over.", 409);
      await claim(tx, c.id, requestId, `sug:invite:${id}`);
      const used = await tx.actionLog.count({ where: { characterId: c.id, action: `sug:invite:${id}` } }); // this call included
      if (used > Math.ceil(R.INVITES.perEvent / R.INVITES.perCall)) throw new GameError("You have sent all the invitations this event allows.", 429);
      const targets = await tx.character.findMany({ where: { OR: list.map((n) => ({ name: { equals: n, mode: "insensitive" } })), id: { not: c.id } }, select: { id: true, name: true } });
      const blocks = await tx.block.findMany({ where: { OR: [{ blockerId: c.id }, { blockedId: c.id }] }, select: { blockerId: true, blockedId: true } });
      const hidden = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId])), ok = targets.filter((t) => !hidden.has(t.id));
      await notify(tx, ok.map((t) => t.id), `📣 ${c.name}, a candidate for ${R.titleOf(ev.candidate.position)}, invites you to "${ev.title}" at ${R.CAMPAIGN_VENUES[ev.venue] ?? "campus"}. It is on for a few minutes.`);
      return { ok: true, invited: ok.map((t) => t.name), skipped: list.length - ok.length };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

/** Publicly back a candidate (shown on their profile). One pledge per voter per race. It adds to the candidate's reach, never to the vote count. */
export async function pledge(db, userId, { candidateId, requestId } = {}) {
  needReq(requestId); const cid = Number(candidateId); if (!Number.isInteger(cid)) throw new GameError("Choose a candidate.");
  const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), cand = await tx.sugCandidate.findUnique({ where: { id: cid } }), cycle = cand && await tx.sugCycle.findUnique({ where: { id: cand.cycleId } });
      await claim(tx, c.id, requestId, "sug:pledge");
      if (!cand || cand.status !== "ACTIVE" || cycle.status !== "LIVE" || cycle.resultsAt) throw new GameError("That candidate is not standing.", 404);
      if (!(now >= +cycle.campaignStartsAt && now < +cycle.votingEndsAt)) throw new GameError("You can pledge support during the campaign and voting periods.", 409);
      const bad = R.voterIssues(c, now); if (bad.length) throw new GameError(bad.join(" "), 403);
      if (cand.characterId === c.id) throw new GameError("You cannot pledge to yourself.", 409);
      const already = await tx.sugSupport.findFirst({ where: { supporterId: c.id, pledged: true, candidate: { raceId: cand.raceId } } });
      if (already) throw new GameError(already.candidateId === cand.id ? "You already back this candidate." : "You already back another candidate in this race.", 409);
      await tx.sugSupport.upsert({ where: { candidateId_supporterId: { candidateId: cand.id, supporterId: c.id } }, create: { candidateId: cand.id, supporterId: c.id, pledged: true }, update: { pledged: true } });
      return { ok: true };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

// ---- finishing events ----
/** Settle one event inside a transaction: count who came, how many were new to the candidate, and award what the rules allow. Idempotent: it does nothing if the event is already settled. */
async function settleOne(tx, ev, now) {
  const fresh0 = await tx.$queryRaw`SELECT status FROM "SugCampaignEvent" WHERE id=${ev.id} FOR UPDATE`;
  if (!fresh0.length || fresh0[0].status !== "LIVE") return null;
  const k = R.EVENT_KINDS[ev.kind], cand = await tx.sugCandidate.findUnique({ where: { id: ev.candidateId } });
  const att = await tx.sugEventAttendance.findMany({ where: { eventId: ev.id }, select: { characterId: true } });
  const opp = ev.opponentId ? await tx.sugCandidate.findUnique({ where: { id: ev.opponentId }, select: { characterId: true } }) : null;
  const audience = att.map((a) => a.characterId).filter((x) => x !== cand.characterId && x !== opp?.characterId), opponentCame = !!opp && att.some((a) => a.characterId === opp.characterId);
  const known = new Set((await tx.sugSupport.findMany({ where: { candidateId: ev.candidateId, supporterId: { in: audience } }, select: { supporterId: true } })).map((x) => x.supporterId));
  const freshOnes = audience.filter((x) => !known.has(x)), day = await dayWindow(tx, +ev.endsAt), room = Math.max(0, R.DAILY_MOMENTUM_CAP - (await dayMomentum(tx, ev.candidateId, day.start)));
  const out = R.eventOutcome(ev.kind, { attendees: audience.length, fresh: freshOnes.length, room, opponentCame });
  if (k.live && out.success && freshOnes.length) await tx.sugSupport.createMany({ data: freshOnes.map((supporterId) => ({ candidateId: ev.candidateId, supporterId })), skipDuplicates: true });
  await tx.sugCampaignEvent.update({ where: { id: ev.id }, data: { status: out.success ? "SUCCESS" : "FAILED", settledAt: new Date(now), attendees: audience.length, freshAudience: out.success ? freshOnes.length : 0, momentum: out.momentum, note: out.note } });
  const verdict = out.success ? `✅ ${ev.title}: it worked${out.momentum ? ` (+${out.momentum} campaign momentum)` : ""}. ${out.note}` : `❌ ${ev.title}: it fell flat. ${out.note}`;
  if (k.live) await notify(tx, [cand.characterId], verdict);
  return out;
}

/** Settle the live events whose time is up. Called from advance() on every request; a few at a time. */
export async function settleDueEvents(db, now = serverNow()) {
  const due = await db.sugCampaignEvent.findMany({ where: { status: "LIVE", endsAt: { lte: new Date(now) } }, orderBy: { endsAt: "asc" }, take: 25 });
  for (const ev of due) { try { await db.$transaction((tx) => settleOne(tx, ev, now)); } catch (e) { if (e?.code !== "P2034") console.error("sug: settle failed", e?.message); } }
  return due.length;
}

/** Campaign activity for the dashboard: what is on now, what is coming, your own history and the public feed. Messages are public. */
export async function getCampaign(db, userId, { position } = {}) {
  const now = serverNow(); await advance(db, now); const c = await myCharacter(db, userId);
  const cycle = await liveCycle(db); if (!cycle) return { serverNow: now, live: [], recent: [], messages: [], mine: null };
  const where = { cycleId: cycle.id, ...(position && R.isElectedPosition(position) ? { candidate: { position } } : {}) };
  const [live, recent, messages, mine] = await Promise.all([
    db.sugCampaignEvent.findMany({ where: { ...where, status: "LIVE", endsAt: { gt: new Date(now) }, kind: { in: ["SPEECH", "RALLY", "MEET", "DEBATE"] } }, orderBy: { endsAt: "asc" }, take: 30, include: { candidate: { select: { id: true, characterId: true, position: true, slogan: true } } } }),
    db.sugCampaignEvent.findMany({ where: { ...where, status: { in: ["SUCCESS", "FAILED"] } }, orderBy: { id: "desc" }, take: 12, include: { candidate: { select: { id: true, characterId: true, position: true } } } }),
    db.sugCampaignEvent.findMany({ where: { ...where, kind: { in: ["MESSAGE", "POSTER", "PUBLICITY"] } }, orderBy: { id: "desc" }, take: 20, include: { candidate: { select: { id: true, characterId: true, position: true } } } }),
    db.sugCandidate.findFirst({ where: { cycleId: cycle.id, characterId: c.id, status: "ACTIVE" } }),
  ]);
  const ids = [...new Set([...live, ...recent, ...messages].map((e) => e.candidate.characterId))];
  const names = new Map((await db.character.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  const mineOpp = mine ? new Set(live.filter((e) => e.opponentId === mine.id).map((e) => e.id)) : new Set();
  const shape = (e) => ({ id: e.id.toString(), kind: e.kind, label: R.EVENT_KINDS[e.kind].label, title: e.title, body: e.body, venue: e.venue, venueName: R.CAMPAIGN_VENUES[e.venue] ?? null, status: e.status, startsAt: +e.startsAt, endsAt: +e.endsAt,
    attendees: e.attendees, note: e.note, candidateId: e.candidateId, host: names.get(e.candidate.characterId) ?? "Candidate", position: e.candidate.position, positionTitle: R.titleOf(e.candidate.position), mine: e.candidate.characterId === c.id,
    debateWithMe: mineOpp.has(e.id) });
  const out = { serverNow: now, live: live.map(shape), recent: recent.map(shape), messages: messages.map(shape), mine: null };
  if (mine) {
    const day = await dayWindow(db, now), used = await db.sugCampaignEvent.groupBy({ by: ["kind"], where: { candidateId: mine.id, createdAt: { gte: new Date(day.start) } }, _count: { _all: true } });
    const spent = (await db.sugExpense.aggregate({ where: { candidateId: mine.id }, _sum: { amountKobo: true } }))._sum.amountKobo ?? 0n;
    out.mine = { candidateId: mine.id, position: mine.position, spentKobo: spent.toString(), capKobo: R.capFor(cycle, mine.position).toString(), usedToday: Object.fromEntries(used.map((u) => [u.kind, u._count._all])),
      momentumToday: await dayMomentum(db, mine.id, day.start), momentumCap: R.DAILY_MOMENTUM_CAP, placeId: c.placeId };
  }
  return out;
}