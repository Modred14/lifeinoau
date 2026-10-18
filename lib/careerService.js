// lib/careerService.js
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { roll } from "./rng.js";
import { cleanText } from "./rules.js";
import { JOBS, MAX_SHIFTS_PER_WEEK, SHIFTS_PER_LEVEL, SHIFT_TYPES, jobLevel, canTake, beginShift, shiftBlock, shiftEnergy, windowText, minuteOfDay } from "./jobs.js";
import { dayWindow } from "./clock.js";
import { clamp, waitText } from "./engine.js";
import { TYPES, MAX_LEVEL, MAX_EMPLOYEES, maxBusinesses, reserveFor, upgradeCost, weekly } from "./business.js";
const N = (n) => BigInt(n) * 100n, mid = (a, b) => Math.floor((a + b) / 2); // mid-point roll = a "typical" week with no event
const s = (k) => k.toString();

const rows = (tx, where, extra = {}) => tx.jobShift.findMany({ where, ...extra });

/** The shift menu for the screen: what each shift pays at this player's job level, and why it cannot be started right now (if it cannot). */
function shiftMenu(job, c, ctx) {
  const lvl = 1 + 0.12 * jobLevel(c.jobXp);
  return job.shifts.map((key) => {
    const t = SHIFT_TYPES[key];
    return { key, label: t.label, window: windowText(key), hours: job.hours, energy: shiftEnergy(job, key),
      payMin: Math.round(job.pay[0] * lvl * t.payMult), payMax: Math.round(job.pay[1] * lvl * t.payMult), blocked: shiftBlock(job, key, ctx) };
  });
}

export async function getCareer(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await start(db, userId), now = Date.now();
  const c = await db.character.findUnique({ where: { id: base.id }, include: { faculty: true } });
  const day = await dayWindow(db, now);
  const [weekShifts, active, today, biz] = await Promise.all([
    db.jobShift.count({ where: { characterId: c.id, gameWeek: week } }),
    db.jobShift.findFirst({ where: { characterId: c.id, status: "ACTIVE" } }),
    db.jobShift.findFirst({ where: { characterId: c.id, gameDay: day.day } }),
    db.business.findMany({ where: { characterId: c.id, status: "ACTIVE" }, orderBy: { id: "asc" } })]);
  const job = c.jobKey && JOBS[c.jobKey];
  const minute = minuteOfDay(day.start, now);
  const ctx = { minute, energy: c.energy, activeShift: !!active, lastShiftDay: today ? day.day : null, day: day.day, weekShifts,
    busy: c.jailedUntil && +c.jailedUntil > now ? "You are in N-QRS custody." : c.sleepingSince ? "You are asleep. Wake up first." : null };
  // the next day this player may clock in: the start of the day after their latest shift (never before that shift has ended)
  const last = today ?? (await db.jobShift.findFirst({ where: { characterId: c.id }, orderBy: { gameDay: "desc" } }));
  const nextEligibleAt = last ? Math.max(day.end, last.status === "ACTIVE" ? +last.endsAt : 0) : null;
  return { week, serverNow: now, gameMinute: minute, dayEndsAt: day.end, level: c.level, maxBusinesses: maxBusinesses(c.level),
    job: job && { key: c.jobKey, title: job.title, level: jobLevel(c.jobXp), xp: c.jobXp, shiftsToNext: SHIFTS_PER_LEVEL - (c.jobXp % SHIFTS_PER_LEVEL), shiftsThisWeek: weekShifts, maxShifts: MAX_SHIFTS_PER_WEEK, energy: job.energy, hours: job.hours,
      shifts: shiftMenu(job, c, ctx),
      workedToday: !!today, nextShiftAt: today ? day.end : null, nextEligibleAt,
      active: active && { id: s(active.id), shift: active.shiftKey, jobKey: active.jobKey, startedAt: +active.startedAt, endsAt: +active.endsAt, energy: active.energyCost, payKobo: s(active.payKobo), done: now >= +active.endsAt } },
    jobs: Object.entries(JOBS).map(([key, j]) => ({ key, title: j.title, payMin: j.pay[0], payMax: j.pay[1], energy: j.energy, hours: j.hours, shifts: j.shifts, locked: canTake(j, c.level, c.faculty.name) })),
    types: Object.entries(TYPES).map(([type, t]) => ({ type, label: t.label, costKobo: s(N(t.cost)) })),
    businesses: biz.map((b) => ({ id: s(b.id), name: b.name, type: b.type, label: TYPES[b.type].label, level: b.level, employees: b.employees, reputation: b.reputation, capitalKobo: s(b.capital),
      expectedNetKobo: s(weekly(b, mid).net), upgradeCostKobo: b.level < MAX_LEVEL ? s(upgradeCost(b.type, b.level)) : null, reserveKobo: s(reserveFor(b.type)), maxEmployees: MAX_EMPLOYEES })) };
}

/**
 * pick / quit / start / claim / abandon. Every rule is decided here, inside one transaction with the player's row locked:
 *  - start: needs the shift window to be open on the game clock, enough energy, no shift running, no shift yet today, fewer than 5 this week.
 *    The pay is rolled and the energy taken now. A unique index also stops two active shifts or two shifts on one in-game day.
 *  - claim: only after the shift has ended, only once (the shift row is flipped ACTIVE -> CLAIMED in the same step that pays, and the ledger key is the shift id).
 */
export async function jobAction(db, userId, { action, job, shift, requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { awake: action === "start" || action === "claim" }), now = Date.now();
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: action === "start" ? "jobstart" : action === "claim" ? "jobclaim" : "jobmgmt", gameWeek: week } }); // P2002 on replay
      const running = await tx.jobShift.findFirst({ where: { characterId: c.id, status: "ACTIVE" } });
      if (action === "pick") {
        if (running) throw new GameError("Finish or claim your current shift first.", 409);
        const j = JOBS[job]; if (!j) throw new GameError("Unknown job.");
        const why = canTake(j, c.level, c.faculty.name); if (why) throw new GameError(why);
        await tx.character.update({ where: { id: c.id }, data: { jobKey: job, jobXp: c.jobKey === job ? c.jobXp : 0 } });
        return { ok: true, note: `You are now a ${j.title}.` };
      }
      if (action === "quit") {
        if (running) throw new GameError("Finish or claim your current shift first.", 409);
        await tx.character.update({ where: { id: c.id }, data: { jobKey: null, jobXp: 0 } }); return { ok: true, note: "You quit your job." };
      }
      if (action === "start") {
        const j = c.jobKey && JOBS[c.jobKey]; if (!j) throw new GameError("Pick a job first.");
        if (await tx.hustleRun.findFirst({ where: { characterId: c.id, status: "ACTIVE" } })) throw new GameError("You are in the middle of a hustle. Finish it first.", 409);
        const day = await dayWindow(tx, now);
        const [today, weekShifts] = await Promise.all([tx.jobShift.findFirst({ where: { characterId: c.id, gameDay: day.day } }), tx.jobShift.count({ where: { characterId: c.id, gameWeek: week } })]);
        const why = shiftBlock(j, shift, { minute: minuteOfDay(day.start, now), energy: c.energy, activeShift: !!running, lastShiftDay: today ? day.day : null, day: day.day, weekShifts, busy: null });
        if (why) throw new GameError(why, 409);
        const r = beginShift(c, j, c.jobXp, shift, now, roll); if (r.error) throw new GameError(r.error, 409);
        await tx.jobShift.create({ data: { characterId: c.id, jobKey: c.jobKey, shiftKey: shift, gameDay: day.day, gameWeek: week, startedAt: new Date(now), endsAt: new Date(r.endsAtMs), energyCost: r.energyCost, payKobo: N(r.payNaira), requestId } });
        await tx.character.update({ where: { id: c.id }, data: { energy: clamp(c.energy - r.energyCost) } });
        return { ok: true, note: `You clocked in for the ${shift} shift.`, endsAt: r.endsAtMs, energy: r.energyCost };
      }
      if (action === "abandon") {
        if (!running) throw new GameError("You are not on a shift.", 409);
        await tx.jobShift.updateMany({ where: { id: running.id, status: "ACTIVE" }, data: { status: "ABANDONED", claimedAt: new Date(now) } });
        return { ok: true, note: "You walked off the shift. No pay, and today's shift is used." };
      }
      if (action !== "claim") throw new GameError("Unknown action.");
      if (!running) throw new GameError("You have no finished shift to claim.", 409);
      if (now < +running.endsAt) throw new GameError(`Your shift ends in ${waitText(+running.endsAt - now)}.`, 409);
      const j = JOBS[running.jobKey];
      const flipped = await tx.jobShift.updateMany({ where: { id: running.id, status: "ACTIVE" }, data: { status: "CLAIMED", claimedAt: new Date(now) } });
      if (flipped.count !== 1) return { ok: true, duplicate: true }; // someone else got there first: it is paid already
      const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
      await transferInTx(tx, { fromId: world.id, toId: c.account.id, amount: running.payKobo, memo: `${j.title} ${running.shiftKey} shift`, key: `shift:${running.id}`, week });
      const xp = c.jobXp + 1;
      await tx.character.update({ where: { id: c.id }, data: { jobXp: xp, popularity: clamp(c.popularity + (j.pop ?? 0)) } });
      return { ok: true, paidKobo: s(running.payKobo), levelUp: jobLevel(xp) > jobLevel(c.jobXp) ? jobLevel(xp) : null };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}

export async function bizAction(db, userId, { action, type, name, id, amountNaira, requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "biz:" + action, gameWeek: week } });
      const pool = await tx.account.findUnique({ where: { systemName: "BUSINESS" } }), world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
      const key = (p) => `${p}:${c.id}:${requestId}`, toPool = (amount, memo) => transferInTx(tx, { fromId: c.account.id, toId: pool.id, amount, memo, key: key("bin"), week });
      if (action === "start") {
        const T = TYPES[type]; if (!T) throw new GameError("Choose a business type.");
        const nm = cleanText(name, 24); if (nm.length < 3) throw new GameError("Give your business a name (3+ letters).");
        const active = await tx.business.count({ where: { characterId: c.id, status: "ACTIVE" } });
        if (active >= maxBusinesses(c.level)) throw new GameError(`At ${c.level}L you can run ${maxBusinesses(c.level)} business(es). Level up for more.`, 409);
        await toPool(N(T.cost), `Start ${nm}`);
        await tx.business.create({ data: { characterId: c.id, type, name: nm, capital: N(T.cost), startedWeek: week, lastWeek: week } });
        return { ok: true, note: `${nm} is open for business.` };
      }
      const b = await tx.business.findFirst({ where: { id: BigInt(id ?? 0), characterId: c.id, status: "ACTIVE" } });
      if (!b) throw new GameError("Business not found.", 404);
      const n = Number(amountNaira), data = {};
      if (action === "capital") {
        if (!Number.isInteger(n) || n < 10_000 || n > 5_000_000) throw new GameError("Add between ₦10,000 and ₦5,000,000.");
        await toPool(N(n), `Capital for ${b.name}`); data.capital = b.capital + N(n);
      } else if (action === "withdraw") {
        const room = b.capital - reserveFor(b.type);
        if (!Number.isInteger(n) || n < 1 || N(n) > room) throw new GameError("You can only withdraw what is above the safety reserve.");
        await transferInTx(tx, { fromId: pool.id, toId: c.account.id, amount: N(n), memo: `Withdrawal from ${b.name}`, key: key("bout"), week }); data.capital = b.capital - N(n);
      } else if (action === "hire") { if (b.employees >= MAX_EMPLOYEES) throw new GameError("You have a full team."); data.employees = b.employees + 1;
      } else if (action === "fire") { if (b.employees <= 0) throw new GameError("There is nobody to let go."); data.employees = b.employees - 1;
      } else if (action === "upgrade") {
        if (b.level >= MAX_LEVEL) throw new GameError("Already at the top level."); const cost = upgradeCost(b.type, b.level);
        if (b.capital < cost + reserveFor(b.type)) throw new GameError("Add more capital first: an upgrade is paid from the business and leaves the safety reserve untouched.");
        await transferInTx(tx, { fromId: pool.id, toId: world.id, amount: cost, memo: `Upgrade ${b.name}`, key: key("bup"), week }); data.capital = b.capital - cost; data.level = b.level + 1;
      } else if (action === "close") {
        if (b.capital > 0n) await transferInTx(tx, { fromId: pool.id, toId: c.account.id, amount: b.capital, memo: `Closed ${b.name}`, key: key("bout"), week });
        data.capital = 0n; data.status = "CLOSED";
      } else throw new GameError("Unknown action.");
      await tx.business.update({ where: { id: b.id }, data });
      return { ok: true };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402);
    throw e;
  }
}