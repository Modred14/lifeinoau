// lib/careerService.js
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { roll } from "./rng.js";
import { cleanText } from "./rules.js";
import { JOBS, MAX_SHIFTS_PER_WEEK, SHIFTS_PER_LEVEL, jobLevel, canTake, resolveShift } from "./jobs.js";
import { TYPES, MAX_LEVEL, MAX_EMPLOYEES, maxBusinesses, reserveFor, upgradeCost, weekly } from "./business.js";
const N = (n) => BigInt(n) * 100n, mid = (a, b) => Math.floor((a + b) / 2); // mid-point roll = a "typical" week with no event
const s = (k) => k.toString();

export async function getCareer(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await start(db, userId);
  const c = await db.character.findUnique({ where: { id: base.id }, include: { faculty: true } });
  const [shifts, biz] = await Promise.all([db.actionLog.count({ where: { characterId: c.id, action: "job", gameWeek: week } }),
    db.business.findMany({ where: { characterId: c.id, status: "ACTIVE" }, orderBy: { id: "asc" } })]);
  const job = c.jobKey && JOBS[c.jobKey];
  return { week, level: c.level, maxBusinesses: maxBusinesses(c.level),
    job: job && { key: c.jobKey, title: job.title, level: jobLevel(c.jobXp), xp: c.jobXp, shiftsToNext: SHIFTS_PER_LEVEL - (c.jobXp % SHIFTS_PER_LEVEL), shiftsThisWeek: shifts, maxShifts: MAX_SHIFTS_PER_WEEK, energy: job.energy },
    jobs: Object.entries(JOBS).map(([key, j]) => ({ key, title: j.title, payMin: j.pay[0], payMax: j.pay[1], energy: j.energy, locked: canTake(j, c.level, c.faculty.name) })),
    types: Object.entries(TYPES).map(([type, t]) => ({ type, label: t.label, costKobo: s(N(t.cost)) })),
    businesses: biz.map((b) => ({ id: s(b.id), name: b.name, type: b.type, label: TYPES[b.type].label, level: b.level, employees: b.employees, reputation: b.reputation, capitalKobo: s(b.capital),
      expectedNetKobo: s(weekly(b, mid).net), upgradeCostKobo: b.level < MAX_LEVEL ? s(upgradeCost(b.type, b.level)) : null, reserveKobo: s(reserveFor(b.type)), maxEmployees: MAX_EMPLOYEES })) };
}

export async function jobAction(db, userId, { action, job, requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: action === "work" ? "job" : "jobmgmt", gameWeek: week } }); // P2002 on replay
      if (action === "pick") {
        const j = JOBS[job]; if (!j) throw new GameError("Unknown job.");
        const why = canTake(j, c.level, c.faculty.name); if (why) throw new GameError(why);
        await tx.character.update({ where: { id: c.id }, data: { jobKey: job, jobXp: c.jobKey === job ? c.jobXp : 0 } });
        return { ok: true, note: `You are now a ${j.title}.` };
      }
      if (action === "quit") { await tx.character.update({ where: { id: c.id }, data: { jobKey: null, jobXp: 0 } }); return { ok: true, note: "You quit your job." }; }
      if (action !== "work") throw new GameError("Unknown action.");
      const j = c.jobKey && JOBS[c.jobKey]; if (!j) throw new GameError("Pick a job first.");
      const done = await tx.actionLog.count({ where: { characterId: c.id, action: "job", gameWeek: week } }); // includes this request
      if (done > MAX_SHIFTS_PER_WEEK) throw new GameError(`You can work ${MAX_SHIFTS_PER_WEEK} shifts a week.`, 409);
      const r = resolveShift(c, j, c.jobXp, roll); if (r.error) throw new GameError(r.error);
      const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
      await transferInTx(tx, { fromId: world.id, toId: c.account.id, amount: r.payKobo, memo: `${j.title} shift`, key: `job:${c.id}:${requestId}`, week });
      await tx.character.update({ where: { id: c.id }, data: { ...r.stats, jobXp: r.xp } });
      return { ok: true, paidKobo: s(r.payKobo), levelUp: jobLevel(r.xp) > jobLevel(c.jobXp) ? jobLevel(r.xp) : null };
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
