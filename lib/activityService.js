// lib/activityService.js
// lib/activityService.js
// Server side of building activities (the rules and the building map are in lib/activities.js).
//
// How a use goes
//   report   the 3D scene says where the player stands, every few seconds while inside. The server accepts a position only if the player really
//            travelled to this building, it is on walkable floor, and it is reachable from the last one in the time that passed (or, for the
//            first one after arriving, it is at the door). A player who wanders away from a running activity cancels it.
//   start    beside a ring (the server computes where the rings are from the same plan the scene draws): checks the person may do it now
//            (energy, health, course, exam week, cash, and the hustles' own limits; nothing else rate-limits a repeat), takes the fee, and records a RUNNING row.
//   finish   after the duration has passed, still beside the ring: applies the stat changes (academics and popularity are cut to the week's allowance), or runs the
//            existing rule for classes, tests, the exam and the two hustles, and marks the row DONE.
// Everything runs under the player's row lock (one thing at a time), the position and clock are the server's, and every request carries a
// requestId, so a repeated or simultaneous request can neither pay twice nor claim twice. Nothing the browser sends decides a reward.
import fs from "node:fs";
import path from "node:path";
import { currentWeek, dayWindow, serverNow } from "./clock.js";
import { isJailed, CUSTODY_PLACE } from "./discipline.js";
import { cellsOf, custodyPlacement } from "./custodyCells.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { GameError, loadLocked, start as startWeek, needReq, actionInTx, riskyInTx, examInTx, hustleToday } from "./gameService.js";
import { courseActionInTx } from "./courseService.js";
import { hustleBlock, HUSTLE } from "./engine.js";
import { coursesFor } from "./curriculum.js";
import { resolveCourseAction, surpriseTest, attendanceRate } from "./courses.js";
import { roll } from "./rng.js";
import { homePlace, placeOf } from "./travel.js";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { classify, buildInterior, isOpenSpace, buildOpenInterior } from "../lib3d/interiors/index.js";
import { activityHubs } from "../lib3d/interiors/activityHubs.js";
import { isClub, clubOf, clubStatus, closedMessage } from "./clubs.js";
import { perksAt } from "./clubService.js";
import { ACTIVITIES, BUDGET, LIMITED, PRESENCE, STAT_KEYS, effectsOf, spentOf, budgeted, worthless, apply, unmet, cooldownEnd, stepAllowed, distance, nearHub, waitShort, summaryOf } from "./activities.js";

const DAY = 86_400_000;
export const CLUB_VENUE = { club_quantum: "Quantum", club_0203: "0203", club_divas: "Royal Divas" };

// ---------------------------------------------------------------- the building a player is in
let placeList; // id -> { id, name, kind }
function placeInfo(id) {
  if (!placeList) {
    placeList = new Map(LANDMARKS.map((l) => [l.id, { id: l.id, name: l.name, kind: l.kind }]));
    try { const d = withExtras(JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "data", "oau-campus.json"), "utf8"))); for (const p of d.places) placeList.set(p.id, { id: p.id, name: p.name, kind: p.kind }); } catch { /* the landmark list alone is enough for the named buildings */ }
  }
  return placeList.get(id) ?? { id, name: id, kind: "" };
}
const cache = new Map(); // placeId -> { compiled, hubs } (the compile is the slow part; the result never changes while the server runs)
/** The compiled interior of a place and its activity rings, or null for places that stay outdoors. */
export function interiorOf(placeId) {
  if (cache.has(placeId)) return cache.get(placeId);
  const p = placeInfo(placeId), cl = classify(p.id, p.kind); let out = null;
  if (cl.mode === "interior") { const compiled = buildInterior(p); out = { compiled, spec: cl.spec, ...activityHubs(compiled, cl.spec) }; }
  else if (isOpenSpace(p.id)) out = { compiled: buildOpenInterior(p), spec: null, hubs: [], missing: [] }; // an open space: you can stand and be seen here (same checks), but it has no activity rings
  if (cache.size > 40) cache.delete(cache.keys().next().value); // bounded: only recently used buildings are kept
  cache.set(placeId, out); return out;
}

// ---------------------------------------------------------------- where the player stands
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Validates a claimed position and stores it. Throws GameError if the player could not be there. */
function placeAt(c, inside, claim, now) {
  const x = num(claim?.x), z = num(claim?.z), floor = Number.isInteger(claim?.floor) ? claim.floor : 0;
  if (x === null || z === null || floor < 0 || floor >= inside.compiled.floors) throw new GameError("Your position could not be read. Walk a step and try again.", 400);
  const nv = inside.compiled.navPlayer[floor], sn = nv.snap(x, z);
  if (!sn || distance({ x, z }, { x: sn[0], z: sn[1] }) > 0.6) throw new GameError("You cannot stand there.", 409);
  const jailed = isJailed(c, now), inCustody = placeOf(c) === CUSTODY_PLACE;
  if (jailed && !inCustody) throw new GameError("You are in custody.", 403); // a prisoner has no position anywhere else
  // The cells: a prisoner stands only inside their own cell (their first report is in it, not at the door), and nobody else ever stands in one.
  if (inCustody) { const why = custodyPlacement(cellsOf(inside.compiled), { jailed, characterId: c.id, x, z }); if (why) throw new GameError(why, 409); }
  const prev = c.inPlace === placeOf(c) && c.inAt && c.inX != null ? { x: c.inX, z: c.inZ, at: +new Date(c.inAt) } : null;
  if (prev) { if (!stepAllowed(prev, { x, z }, now)) throw new GameError("You moved too fast. Walk to it.", 409); }
  else if (!jailed) { // a first position is a way IN: a club that is shut lets nobody in (the server decides: the screen only shows it). Someone already inside is never moved.
    if (isClub(placeOf(c)) && !clubStatus(now).open) throw new GameError(closedMessage(clubOf(placeOf(c)), now), 403);
    const sp = inside.compiled.spawn; if (distance({ x, z }, sp) > PRESENCE.enterRadius || floor !== 0) throw new GameError("Walk in through the door first.", 409); }
  else if (floor !== 0) throw new GameError("You cannot stand there.", 409);
  return { x, z, floor };
}
const fromClaim = (c, p, now) => ({ inPlace: placeOf(c), inX: p.x, inZ: p.z, inFloor: p.floor, inAt: new Date(now) });

// ---------------------------------------------------------------- the numbers behind "can I do this now?"
const RUN_SELECT = { activityId: true, status: true, startedAt: true, endsAt: true, finishedAt: true, gameWeek: true, delta: true, hubId: true, param: true, id: true, placeId: true, requestId: true };
// Repeatable activities leave a run row each time, and a player may repeat them all day. So nothing here may depend on "the newest N rows":
//   runsFor      the run that is going now, plus past runs of the few activities that still carry a limit (the exam). Never a pile of sofa naps.
//   spentNow     what was already gained this week from the capped stats, read from the few runs that gained any (a capped stat stops gaining, so there are few).
async function runsFor(tx, characterId, now) {
  return tx.activityRun.findMany({ where: { characterId, status: { in: ["RUNNING", "DONE"] }, startedAt: { gte: new Date(now - 8 * DAY) }, OR: [{ status: "RUNNING" }, { activityId: { in: LIMITED } }] }, orderBy: { startedAt: "desc" }, take: 600 });
}
async function spentNow(tx, characterId, week, dayStart, exceptId = null) {
  const gained = Object.keys(BUDGET).map((k) => ({ delta: { path: [k], gt: 0 } }));
  const rows = await tx.activityRun.findMany({ where: { characterId, status: "DONE", OR: [{ gameWeek: week }, { startedAt: { gte: new Date(dayStart) } }], AND: [{ OR: gained }] }, take: 5000 });
  return spentOf(rows.filter((r) => exceptId == null || r.id !== exceptId), { week, dayStart });
}
const live = (r, now) => r.status === "RUNNING" && +new Date(r.endsAt) + PRESENCE.expireMs > now;
/** Counts, cooldown and budget figures for one activity, from this player's runs. */
function standing(def, id, runs, { now, week, dayStart }) {
  const mine = runs.filter((r) => r.activityId === id);
  return { now, runs: mine, cooldownEndsAt: cooldownEnd(def, mine), day: mine.filter((r) => +new Date(r.startedAt) >= dayStart).length, week: mine.filter((r) => r.gameWeek === week).length };
}

/** Why a player cannot do this activity at this place right now (null if they can), before the fee. `ctx` = { now, week, dayStart, runs, courseRow, exam }. */
function blockOf(c, def, entry, placeId, ctx) {
  const jailed = isJailed(c, ctx.now);
  if (jailed && !def.jailOk) return "You cannot do that while you are in custody.";
  if (def.inmate && !jailed) return "Only people serving a sentence use the cells.";
  if (def.home && homePlace(c.hostel) !== placeId) return "That is not your room. Sleep in your own hall.";
  if (entry.act === "club_drink" && isClub(placeId) && !clubStatus(ctx.now).open) return "The club has closed and the bar is shut. Finish your night and head out.";
  if (c.graduated && (def.kind === "exam" || def.kind.startsWith("course_"))) return "You have graduated. There is no more coursework.";
  const st = standing(def, entry.act, ctx.runs, ctx);
  const why = unmet(c, def, st); if (why) return why;
  if (def.kind === "stats" && worthless(def, c, ctx.spent)) return "You have gained all you can from that for now.";
  if ((def.kind === "hustle_safe" && c.energy < HUSTLE.safe.energy) || (def.kind === "hustle_risky" && c.energy < HUSTLE.risky.energy) || (def.kind === "exam" && c.energy < 20)) return "You are too tired for that. Rest first.";
  if (def.kind === "hustle_safe" || def.kind === "hustle_risky") return hustleBlock(def.kind === "hustle_safe" ? "safe" : "risky", ctx.hustle, ctx.now);
  if (def.kind === "exam") { if (ctx.exam === "none") return "There is no exam this week."; if (ctx.exam === "done") return "You already sat this week's exam."; }
  return null;
}

const need = (cond, msg, status = 409) => { if (!cond) throw new GameError(msg, status); };
const parseId = (s) => { const [act, rest] = String(s ?? "").split(":"); return { act, ok: isActivityKey(act) && /^\d+(\.\d+)?$/.test(rest ?? "") }; };
const isActivityKey = (a) => Object.hasOwn(ACTIVITIES, a);

/** Everything the screen needs to show a building's rings: per ring, whether it can be used now, why not, and when it is free again. */
async function contextOf(tx, c, now, week) {
  const day = await dayWindow(tx, now), runs = await runsFor(tx, c.id, now);
  const exam = await examState(tx, c, week);
  return { now, week, dayStart: day.start, runs, spent: await spentNow(tx, c.id, week, day.start), exam,
    hustle: await hustleToday(tx, c.id, null), perks: await perksAt(tx, c.id, placeOf(c), now) }; // VIP / a running buyout: free bar (club entry itself is free for everyone)
}
async function examState(tx, c, week) {
  const cw = week - c.joinedWeek + 1; if (c.graduated || cw <= 0 || cw % 6 !== 0) return "none";
  return (await tx.examResult.findFirst({ where: { characterId: c.id, gameWeek: week } })) ? "done" : "open";
}

const view = (c, inside, ctx) => inside.hubs.map((h) => {
  const def = ACTIVITIES[h.act], why = blockOf(c, def, { act: h.act }, placeOf(c), ctx), st = standing(def, h.act, ctx.runs, ctx);
  const hide = def.inmate && !isJailed(c, ctx.now); // the cells are not offered to people who are free
  return { id: h.id, act: h.act, label: h.label, sub: summaryOf(def, c), sec: def.sec, blocked: why, until: !why ? 0 : st.cooldownEndsAt > ctx.now ? st.cooldownEndsAt : 0, hidden: hide, kind: def.kind, anim: def.anim, doing: def.doing, icon: def.icon, full: !!def.full };
});
const runView = (r) => r && ({ id: String(r.id), activityId: r.activityId, hubId: r.hubId, endsAt: +new Date(r.endsAt), startedAt: +new Date(r.startedAt) });

// ---------------------------------------------------------------- the requests
const me = async (tx, userId, opts) => loadLocked(tx, userId, opts);
const inBuilding = (c) => { const inside = interiorOf(placeOf(c)); need(inside, "You are not inside a building.", 409); return inside; };
const lockOpts = { allowJailed: true };

/** The 3D scene reports where the player stands. Also cancels a running activity if they walked away from its ring. */
export async function report(db, userId, claim) {
  const week = await startWeek(db, userId);
  return db.$transaction(async (tx) => {
    const c = await me(tx, userId, lockOpts), inside = inBuilding(c), now = serverNow(), p = placeAt(c, inside, claim, now);
    const running = await tx.activityRun.findFirst({ where: { characterId: c.id, status: "RUNNING" }, orderBy: { startedAt: "desc" } });
    let cancelled = null;
    if (running) { const hub = inside.hubs.find((h) => h.id === running.hubId);
      if (!hub || running.placeId !== placeOf(c) || !nearHub({ ...p }, hub, PRESENCE.stayRadius)) { await tx.activityRun.update({ where: { id: running.id }, data: { status: "CANCELLED", finishedAt: new Date(now) } }); cancelled = running.activityId; } }
    await tx.character.update({ where: { id: c.id }, data: fromClaim(c, p, now) });
    return { ok: true, cancelled, week };
  });
}

/** The rings of the building the player is in, with what they can and cannot do right now. */
export async function status(db, userId) {
  const week = await startWeek(db, userId);
  return db.$transaction(async (tx) => {
    const c = await me(tx, userId, lockOpts), inside = interiorOf(placeOf(c)), now = serverNow();
    if (!inside) return { ok: true, placeId: placeOf(c), hubs: [], run: null, now, energy: c.energy };
    const ctx = await contextOf(tx, c, now, week), running = ctx.runs.find((r) => live(r, now) && r.status === "RUNNING") ?? null;
    const courses = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)).map((x) => ({ code: x.code, title: x.title }));
    return { ok: true, placeId: placeOf(c), hubs: view(c, inside, ctx).filter((h) => !h.hidden), run: runView(running), courses, now, energy: c.energy, budgets: ctx.spent };
  });
}

/** Starts an activity at a ring. */
export async function startActivity(db, userId, { hubId, requestId, x, z, floor, param }) {
  needReq(requestId); need(String(requestId).length <= 56, "Missing requestId.", 400);
  const week = await startWeek(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await me(tx, userId, lockOpts), inside = inBuilding(c), now = serverNow();
      if (await tx.activityRun.findFirst({ where: { characterId: c.id, requestId } })) return { ok: true, duplicate: true }; // the same request again: nothing more happens
      const parsed = parseId(hubId); need(parsed.ok, "Unknown activity.", 404);
      const hub = inside.hubs.find((h) => h.id === hubId); need(hub, "That is not available here.", 404);
      const def = ACTIVITIES[hub.act];
      const p = placeAt(c, inside, { x, z, floor }, now);
      need(nearHub(p, hub, PRESENCE.hubRadius), "Walk up to it first. You are too far away.");
      // an earlier run that is still going (or never finished) blocks a second one
      const runs = await runsFor(tx, c.id, now);
      for (const r of runs) if (r.status === "RUNNING") { // one at a time; but a run the player has walked away from (or left the building during) is over
        const rh = inside.hubs.find((h) => h.id === r.hubId), still = live(r, now) && r.placeId === placeOf(c) && rh && nearHub(p, rh, PRESENCE.stayRadius);
        if (still) throw new GameError("You are already busy. Finish or stop that first.", 409);
        await tx.activityRun.update({ where: { id: r.id }, data: { status: "CANCELLED", finishedAt: new Date(now) } }); }
      const ctx = { ...(await contextOf(tx, c, now, week)), runs: (await runsFor(tx, c.id, now)).filter((r) => r.status !== "RUNNING") };
      const why = blockOf(c, def, { act: hub.act }, placeOf(c), ctx); if (why) throw new GameError(why, 429);
      // kind specific checks, so a run is never wasted
      let code = null;
      if (def.kind === "course_attend" || def.kind === "course_study" || def.kind === "course_test") {
        const list = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)); const course = list.find((q) => q.code === param);
        need(course, "Pick one of your courses.", 400); code = course.code;
        const row = await tx.courseProgress.findFirst({ where: { characterId: c.id, sessionStartWeek: c.sessionStartWeek, code } });
        if (def.kind === "course_test") { // a surprise test the lecturer announced this week is the one that has to be sat here (lib/tick.js)
          const waiting = await tx.classTest.findFirst({ where: { characterId: c.id, gameWeek: week, status: "PENDING" } });
          if (waiting && waiting.code !== code) throw new GameError(`Your surprise test this week is in ${waiting.code}. Sit that one.`, 409);
        }
        if (def.kind !== "course_test") { const r = resolveCourseAction(c, def.kind === "course_attend" ? "attend" : "study", row, week, { repeat: true }); if (r.error) throw new GameError(r.error, 409); }
      }
      if (def.kind === "exam") code = param === "cheat" ? "cheat" : "";
      let { cost } = effectsOf(c, def); if (hub.act === "club_drink" && ctx.perks?.freeDrink) cost = 0; // VIP and buyout hosts' guests drink free
      await tx.activityRun.create({ data: { characterId: c.id, requestId, activityId: hub.act, hubId: hub.id, placeId: placeOf(c), status: "RUNNING", startedAt: new Date(now), endsAt: new Date(now + def.sec * 1000), gameWeek: week, param: code } });
      if (cost > 0) { const venues = await tx.account.findUnique({ where: { systemName: "VENUES" } });
        await transferInTx(tx, { fromId: c.account.id, toId: venues.id, amount: BigInt(cost) * 100n, memo: def.memo ?? def.label, key: `actfee:${c.id}:${requestId}`, week }); }
      await tx.character.update({ where: { id: c.id }, data: fromClaim(c, p, now) });
      return { ok: true, started: true, activityId: hub.act, hubId: hub.id, sec: def.sec, endsAt: now + def.sec * 1000, doing: def.doing, anim: def.anim, paid: cost };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402);
    throw e;
  }
}

/** Finishes the running activity once its time is up, and pays out. */
export async function finishActivity(db, userId, { requestId, x, z, floor }) {
  needReq(requestId); need(String(requestId).length <= 56, "Missing requestId.", 400);
  const week = await startWeek(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await me(tx, userId, lockOpts), now = serverNow();
      if (await tx.actionLog.findFirst({ where: { characterId: c.id, requestId: `${requestId}-f` } })) return { ok: true, duplicate: true }; // the same request again
      const run = await tx.activityRun.findFirst({ where: { characterId: c.id, status: "RUNNING" }, orderBy: { startedAt: "desc" } });
      need(run, "There is nothing to finish.", 409);
      const def = ACTIVITIES[run.activityId], inside = interiorOf(run.placeId);
      const cancel = async (msg) => { await tx.activityRun.update({ where: { id: run.id }, data: { status: "CANCELLED", finishedAt: new Date(now) } }); return { ok: true, cancelled: true, message: msg }; };
      if (now > +new Date(run.endsAt) + PRESENCE.expireMs) return cancel("That took too long and was lost.");
      if (!inside || placeOf(c) !== run.placeId) return cancel("You left before it was finished.");
      const hub = inside.hubs.find((h) => h.id === run.hubId); if (!hub) return cancel("That is not available here.");
      const p = placeAt(c, inside, { x, z, floor }, now);
      if (!nearHub(p, hub, PRESENCE.stayRadius)) { await tx.character.update({ where: { id: c.id }, data: fromClaim(c, p, now) }); return cancel("You walked away before it was finished."); }
      need(now >= +new Date(run.endsAt), "It is not finished yet.", 409); // exactly the full time on the server clock: no early finish
      // An exam started in the last seconds of its week would be refused when it is recorded (no exam any more) and the refusal would roll the whole
      // finish back, leaving the run RUNNING and the player stuck on the ring. Say so now and end the run cleanly instead.
      if (def.kind === "exam" && (await examState(tx, c, week)) !== "open") return cancel("The exam week ended before you finished. Nothing was recorded.");
      if (c.graduated && (def.kind === "exam" || def.kind.startsWith("course_"))) return cancel("You have graduated. There is no more coursework.");
      await tx.actionLog.create({ data: { characterId: c.id, requestId: `${requestId}-f`, action: "act:" + run.activityId, gameWeek: week } }); // P2002 on a repeat
      await tx.character.update({ where: { id: c.id }, data: fromClaim(c, p, now) });
      const fresh = { ...c, ...fromClaim(c, p, now) };
      const out = await settle(tx, fresh, def, run, `${run.requestId}-f`, week, now);
      await tx.activityRun.update({ where: { id: run.id }, data: { status: "DONE", finishedAt: new Date(now), delta: (({ energy, ...rest }) => (def.full ? rest : { energy, ...rest }))(out.applied ?? {}) } }); // sleep does not use up the energy allowance
      return { ok: true, activityId: run.activityId, label: def.label, message: def.done, anim: def.anim, ...out };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402);
    throw e;
  }
}

/** Gives the result of a finished run. */
async function settle(tx, c, def, run, key, week, now) {
  if (def.kind === "hustle_safe") { const r = await actionInTx(tx, c, "hustle", key, week); return { applied: {}, earnedKobo: r.earnedKobo, stats: r.stats }; }
  if (def.kind === "hustle_risky") { const r = await riskyInTx(tx, c, key, week); return { applied: {}, ...r }; }
  if (def.kind === "exam") { const r = await examInTx(tx, c, run.param === "cheat", key, week); return { applied: {}, ...r }; }
  if (def.kind === "course_attend" || def.kind === "course_study") { const r = await courseActionInTx(tx, c, week, { action: def.kind === "course_attend" ? "attend" : "study", code: run.param, requestId: key, repeat: true }); return { applied: {}, note: r.note }; }
  if (def.kind === "course_test") return classTest(tx, c, def, run, week, now);
  // plain stat changes, cut to what is left of the day's and week's budgets
  const day = await dayWindow(tx, now);
  const { d, cost } = effectsOf(c, def), { d: got, capped } = budgeted(d, await spentNow(tx, c.id, week, day.start, run.id));
  if (def.full && d.energy) got.energy = d.energy; // sleep is not limited by the energy allowance: it simply fills the bar
  const { stats, applied } = apply(c, got);
  await tx.character.update({ where: { id: c.id }, data: stats });
  return { applied, capped, stats, cost };
}
async function classTest(tx, c, def, run, week, now) {
  const course = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)).find((q) => q.code === run.param);
  if (!course) throw new GameError("That is not one of your courses.", 404);
  const row = await tx.courseProgress.findFirst({ where: { characterId: c.id, sessionStartWeek: c.sessionStartWeek, code: run.param } }), we = week - c.sessionStartWeek + 1;
  const t = surpriseTest(c, course, row, we, roll), day = await dayWindow(tx, now);
  // If this is the surprise test the lecturer announced this week, it is now sat: the record changes from PENDING (which tick.js would turn into a
  // missed test, with its penalty) to TAKEN with the score. Without a pending test this is a practice test and nothing is recorded beyond the run.
  await tx.classTest.updateMany({ where: { characterId: c.id, gameWeek: week, code: run.param, status: "PENDING" }, data: { status: "TAKEN", takenAt: new Date(now), score: t.score } });
  const { d: got, capped } = budgeted({ academics: t.academics, happiness: t.happiness, energy: -8 }, await spentNow(tx, c.id, week, day.start, run.id));
  const { stats, applied } = apply(c, got);
  await tx.character.update({ where: { id: c.id }, data: stats });
  if (t.prep && row) await tx.courseProgress.update({ where: { id: row.id }, data: { prep: Math.min(100, row.prep + t.prep) } });
  return { applied, capped, stats, score: t.score, outOf: 20, note: `${course.code} class test: ${t.score}/20.` };
}

/** Stops a running activity (no refund). */
export async function cancelActivity(db, userId) {
  await startWeek(db, userId);
  return db.$transaction(async (tx) => {
    const c = await me(tx, userId, lockOpts), now = serverNow();
    const n = await tx.activityRun.updateMany({ where: { characterId: c.id, status: "RUNNING" }, data: { status: "CANCELLED", finishedAt: new Date(now) } });
    return { ok: true, cancelled: n.count };
  });
}

export { STAT_KEYS, waitShort };