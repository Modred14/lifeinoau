// lib/tick.js
import { currentWeek } from "./clock.js";
import { closeSession, SESSION_WEEKS } from "./engine.js";
import { weekly, settle } from "./business.js";
import { roll } from "./rng.js";
import { coursesFor } from "./curriculum.js";
import { surpriseTest } from "./courses.js";
import { priceKobo, valueOf } from "./market.js";
import { transferInTx as transfer, InsufficientFunds } from "./ledger.js";
import { rentInstalmentKobo } from "./rules.js";

const ALLOW = { NEPO: 50_000_000n, MAPO: 10_000_000n, LAPO: 3_000_000n }; // kobo
const clamp = (v) => Math.max(0, Math.min(100, v));

/** Catch a player up to the current game week. Call at the start of every authenticated game request.
 *  No per-player cron: the work happens on demand, locked, and each week is processed exactly once. */
export async function catchUp(db, characterId) {
  const week = await currentWeek(db);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id=${characterId} FOR UPDATE`;
    const c = await tx.character.findUnique({ where: { id: characterId }, include: { account: true, faculty: true } });
    if (!c.hostel) return { week, processed: 0 }; // no rent or allowance until the player has chosen a hostel
    if (c.expelled) return { week, processed: 0 }; // expelled: no more weekly simulation
    let grad = c.graduated; // graduates stop studying and get no allowance, but their businesses keep trading
    const start = Math.max(c.lastTickWeek + 1, week - 60); // safety cap
    if (start > week) return { week, processed: 0 }; // nothing new to simulate: do NOT touch the character (no free energy refills), and do no more queries
    const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
    const landlords = await tx.account.findUnique({ where: { systemName: "LANDLORDS" } });
    let miss = c.missedCallStreak, stats = {}, level = c.level, s = c.sessionStartWeek, failed = c.failedSessions, end = {};
    const biz = await tx.business.findMany({ where: { characterId: c.id, status: "ACTIVE" } }), bizAcc = biz.length ? await tx.account.findUnique({ where: { systemName: "BUSINESS" } }) : null;
    const runBiz = async (w) => { // one trading week per business, settled through the ledger
      for (const b of biz) if (b.status === "ACTIVE" && w > b.lastWeek) {
        const res = weekly(b, roll), s = settle(b, res), amt = s.ledger.amount;
        if (amt > 0n) await transfer(tx, s.ledger.dir === "profit"
          ? { fromId: world.id, toId: bizAcc.id, amount: amt, memo: `${b.name} profit`, key: `bizp:${b.id}:${w}`, week: w }
          : { fromId: bizAcc.id, toId: world.id, amount: amt, memo: `${b.name} loss`, key: `bizl:${b.id}:${w}`, week: w });
        b.capital = s.capital; b.reputation = s.reputation; b.lastWeek = w; if (s.bankrupt) b.status = "BANKRUPT";
        await tx.business.update({ where: { id: b.id }, data: { capital: b.capital, reputation: b.reputation, lastWeek: w, status: b.status } });
        if (s.bankrupt) await tx.notification.create({ data: { characterId: c.id, kind: "BUSINESS", body: `${b.name} ran out of money and went bankrupt.` } });
        else if (res.event) await tx.notification.create({ data: { characterId: c.id, kind: "BUSINESS", body: `${b.name} ${res.event}.` } });
      }
    };
    const pend = await tx.pregnancy.findMany({ where: { characterId: c.id, status: "PENDING" } });
    let deps = c.dependents, popLoss = 0, suspendTo = c.suspendedUntilWeek, acadDelta = 0;
    for (let w = start; w <= week; w++) {
      if (grad) { await runBiz(w); continue; }
      const cw = w - c.joinedWeek + 1; // the player's own week count (exam every 6th)
      if (w < week && cw > 0 && cw % 6 === 0) // a missed exam is an automatic fail
        await tx.examResult.createMany({ data: [{ characterId: c.id, gameWeek: w, level, score: 0, gradePoint: 0, missed: true }], skipDuplicates: true });
      if (w === s + SESSION_WEEKS) { // the session that just ended is graded exactly once
        const rs = await tx.examResult.findMany({ where: { characterId: c.id }, select: { gameWeek: true, gradePoint: true } });
        const o = closeSession({ level, failedSessions: failed, allGps: rs.map((r) => r.gradePoint),
          sessionGps: rs.filter((r) => r.gameWeek >= s && r.gameWeek < s + SESSION_WEEKS).map((r) => r.gradePoint) });
        const note = { ADVANCE: `You advanced to ${o.level}L.`, REPEAT: `You failed this session and must repeat ${level}L.`,
          WITHDRAWN: "You were withdrawn after failing two sessions in a row.", GRADUATE: `You graduated with a ${o.classification} (CGPA ${o.cgpa?.toFixed(2)}).` }[o.type];
        await tx.notification.create({ data: { characterId: c.id, kind: "ACADEMIC", body: note } });
        level = o.level; failed = o.failedSessions; s = w;
        if (o.type === "GRADUATE") { end = { graduated: true, graduatedWeek: w, finalCgpaX100: Math.round(o.cgpa * 100), classification: o.classification }; grad = true; await runBiz(w); continue; }
        if (o.type === "WITHDRAWN") { end = { expelled: true }; break; }
      }
      if (c.lastParentCallWeek < w - 1) miss++; else miss = 0;
      const cut = Math.min(0.5, miss * 0.1); // 10% per missed week, max 50%
      const allowance = (ALLOW[c.class] * BigInt(Math.round((1 - cut) * 100))) / 100n;
      await transfer(tx, { fromId: world.id, toId: c.account.id, amount: allowance, memo: "Weekly allowance", key: `allowance:${c.id}:${w}`, week: w });
      try {
        await transfer(tx, { fromId: c.account.id, toId: landlords.id, amount: rentInstalmentKobo(c.hostel, w - s), memo: `Rent (${c.hostel}), week ${w - s + 1} of ${SESSION_WEEKS}`, key: `rent:${c.id}:${w}`, week: w });
      } catch (e) { if (!(e instanceof InsufficientFunds)) throw e; stats.happiness = clamp((stats.happiness ?? c.happiness) - 8); }
      if (deps > 0) { // childcare: N10,000 a week per dependent
        try { await transfer(tx, { fromId: c.account.id, toId: world.id, amount: 1_000_000n * BigInt(deps), memo: "Childcare", key: `childcare:${c.id}:${w}`, week: w }); }
        catch (e) { if (!(e instanceof InsufficientFunds)) throw e; stats.happiness = clamp((stats.happiness ?? c.happiness) - 8); }
      }
      for (const p of pend) if (!p.settled && w > p.decideBy) { // no decision in time: it settles on its own, with consequences
        p.settled = true; deps++; popLoss += 5; stats.happiness = clamp((stats.happiness ?? c.happiness) - 10);
        if (c.gender === "F") suspendTo = Math.max(suspendTo, w + 2); // game-world mechanic, not an OAU rule
        await tx.pregnancy.update({ where: { id: p.id }, data: { status: "UNRESOLVED" } });
        await tx.notification.create({ data: { characterId: c.id, kind: "LIFE", body: "You did not decide in time, so life decided for you. People are talking." } });
      }
      // A lecturer may spring a surprise test (at most one a week). Your score depends on the effort you have put into that course.
      const cs = coursesFor(c.faculty.name, level, Number(c.faculty.difficulty)), totalW = cs.reduce((t, x) => t + x.lecturer.surprise, 0);
      if (cs.length && roll(1, 100) <= Math.min(20, totalW)) {
        let pick = roll(1, totalW), course = cs[cs.length - 1];
        for (const x of cs) { if (pick <= x.lecturer.surprise) { course = x; break; } pick -= x.lecturer.surprise; }
        const row = await tx.courseProgress.findFirst({ where: { characterId: c.id, sessionStartWeek: s, code: course.code } });
        const r = surpriseTest({ academics: clamp(c.academics + acadDelta) }, course, row, w - s + 1, roll);
        acadDelta += r.academics; stats.happiness = clamp((stats.happiness ?? c.happiness) + r.happiness);
        if (row && r.prep) await tx.courseProgress.update({ where: { id: row.id }, data: { prep: Math.min(100, row.prep + r.prep) } });
        await tx.notification.create({ data: { characterId: c.id, kind: "ACADEMIC", body: `${course.lecturer.name} announced a surprise test in ${course.code}. You scored ${r.score}/20.` } });
      }
      await runBiz(w);
    }
    for (const h of await tx.holding.findMany({ where: { characterId: c.id } })) // mark investments to market (feeds net worth and Forbes)
      await tx.holding.update({ where: { id: h.id }, data: { valueKobo: valueOf(h.unitsMicro, priceKobo(h.product, week)) } });
    await tx.character.update({ where: { id: c.id }, data: { lastTickWeek: week, level, sessionStartWeek: s, failedSessions: failed, ...end, missedCallStreak: miss, dependents: deps, popularity: clamp(c.popularity - popLoss), academics: clamp(c.academics + acadDelta), suspendedUntilWeek: suspendTo, energy: 100, suspicion: Math.max(0, c.suspicion - 3 * Math.max(1, week - start + 1)), ...stats } });
    return { week, processed: Math.max(0, week - start + 1) };
  });
}