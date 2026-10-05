// lib/relationshipService.js
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { currentWeek } from "./clock.js";
import { roll } from "./rng.js";
import { clamp } from "./engine.js";
import { candidates, resolveRelAction, canAdvance, nextStage, decayFor, STAGES, LABEL, NEED } from "./relationships.js";
const N = (n) => BigInt(n) * 100n;
const ago = (rel, week) => Math.max(0, rel.affection - decayFor(rel.lastWeek, week));

export async function getRelationship(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true, gender: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await start(db, userId);
  const [active, ended, preg] = await Promise.all([
    db.relationship.findFirst({ where: { characterId: base.id, status: "ACTIVE" } }),
    db.relationship.findFirst({ where: { characterId: base.id, status: "ENDED", endedWeek: { gte: week - 4 } }, orderBy: { endedWeek: "desc" } }),
    db.pregnancy.findFirst({ where: { characterId: base.id, status: "PENDING" } })]);
  const aff = active ? ago(active, week) : 0, nx = active && nextStage(active.stage);
  return { week, partnerIsPregnant: base.gender === "M",
    current: active && { npcName: active.npcName, trait: active.npcTrait, stage: active.stage, label: LABEL[active.stage], affection: aff, nextLabel: nx ? LABEL[nx] : null, nextNeeded: nx ? NEED[nx] : null,
      canAdvance: canAdvance({ ...active, affection: aff }), giftedThisWeek: active.lastGiftWeek === week, datedThisWeek: active.lastDateWeek === week },
    candidates: active ? [] : candidates(base.id, base.gender, week), reconcile: !active && ended ? { npcName: ended.npcName, endedWeek: ended.endedWeek } : null,
    pregnancy: preg && { decideBy: preg.decideBy, weeksLeft: Math.max(0, preg.decideBy - week + 1) } };
}

export async function relate(db, userId, { action, slot, tier, requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "rel:" + action, gameWeek: week } }); // P2002 on replay
      const active = await tx.relationship.findFirst({ where: { characterId: c.id, status: "ACTIVE" } });
      const venues = await tx.account.findUnique({ where: { systemName: "VENUES" } });
      const pay = (amount, memo, key) => transferInTx(tx, { fromId: c.account.id, toId: venues.id, amount, memo, key: `${key}:${c.id}:${requestId}`, week });
      if (action === "start") {
        if (active) throw new GameError("You are already seeing someone. End it first.", 409);
        const pick = candidates(c.id, c.gender, week)[Number(slot)]; if (!pick) throw new GameError("Choose someone.");
        await tx.relationship.create({ data: { characterId: c.id, npcName: pick.name, npcTrait: pick.trait, lastWeek: week, startedWeek: week } });
        return { ok: true, note: `You started talking to ${pick.name}.` };
      }
      if (action === "reconcile") {
        if (active) throw new GameError("You are already seeing someone.", 409);
        const last = await tx.relationship.findFirst({ where: { characterId: c.id, status: "ENDED", endedWeek: { gte: week - 4 } }, orderBy: { endedWeek: "desc" } });
        if (!last) throw new GameError("There is nobody to get back to.", 404);
        await pay(N(10_000), "Reconciliation gift", "recon");
        await tx.relationship.update({ where: { id: last.id }, data: { status: "ACTIVE", endedWeek: null, lastWeek: week, stage: STAGES.indexOf(last.stage) >= 2 ? "TALKING" : "FRIEND", affection: Math.max(40, Math.floor(last.affection / 2)) } });
        return { ok: true, note: `You and ${last.npcName} are talking again.` };
      }
      if (!active) throw new GameError("You are not seeing anyone.", 404);
      const aff = ago(active, week);
      if (action === "advance") {
        if (!canAdvance({ ...active, affection: aff })) throw new GameError("It is too soon. Spend more time together first.");
        const nx = nextStage(active.stage);
        await tx.relationship.update({ where: { id: active.id }, data: { stage: nx, affection: aff, lastWeek: week } });
        return { ok: true, note: `You are now: ${LABEL[nx]}.` };
      }
      if (action === "breakup") {
        await tx.relationship.update({ where: { id: active.id }, data: { status: "ENDED", endedWeek: week } });
        await tx.character.update({ where: { id: c.id }, data: { happiness: clamp(c.happiness - (STAGES.indexOf(active.stage) >= 2 ? 10 : 3)) } });
        return { ok: true, note: `You ended things with ${active.npcName}.` };
      }
      const pend = await tx.pregnancy.findFirst({ where: { characterId: c.id, status: "PENDING" } });
      if ((action === "close" || action === "safe-close") && pend) throw new GameError("Sort out what is happening first.", 409);
      const r = resolveRelAction(c, active, action, { tier }, roll, week); if (r.error) throw new GameError(r.error);
      if (r.costKobo > 0n) await pay(r.costKobo, { gift: "Gift", date: "Date", close: "Night out", "safe-close": "Night out" }[action] ?? "Spending", "rel");
      await tx.relationship.update({ where: { id: active.id }, data: { affection: r.affection, lastWeek: week, ...(action === "gift" ? { lastGiftWeek: week } : {}), ...(action === "date" ? { lastDateWeek: week } : {}) } });
      await tx.character.update({ where: { id: c.id }, data: r.stats });
      if (r.pregnancy) {
        await tx.pregnancy.create({ data: { characterId: c.id, relationshipId: active.id, startedWeek: week, decideBy: week + 2 } });
        await tx.notification.create({ data: { characterId: c.id, kind: "LIFE", body: c.gender === "F" ? "You think you might be pregnant. You have 2 game weeks to decide what to do." : `${active.npcName} says she is pregnant. You have 2 game weeks to decide together what to do.` } });
      }
      return { ok: true, note: r.note, affection: r.affection, pregnancy: r.pregnancy };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402);
    throw e;
  }
}

/** Neutral, abstract game mechanic. Costs are fixed; consequences are stats, money and reputation. */
export async function decidePregnancy(db, userId, { choice, requestId }) {
  needReq(requestId);
  if (!["keep", "end"].includes(choice)) throw new GameError("Choose an option.");
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "preg:" + choice, gameWeek: week } });
      const p = await tx.pregnancy.findFirst({ where: { characterId: c.id, status: "PENDING" } });
      if (!p) throw new GameError("There is nothing to decide right now.", 404);
      const clinics = await tx.account.findUnique({ where: { systemName: "CLINICS" } });
      const keep = choice === "keep";
      await transferInTx(tx, { fromId: c.account.id, toId: clinics.id, amount: N(keep ? 150_000 : 500_000), memo: keep ? "Baby setup costs" : "Clinic fees", key: `preg:${p.id}`, week });
      await tx.pregnancy.update({ where: { id: p.id }, data: { status: keep ? "KEPT" : "ENDED" } });
      await tx.character.update({ where: { id: c.id }, data: keep
        ? { dependents: c.dependents + 1, happiness: clamp(c.happiness - 5), popularity: clamp(c.popularity - 2) }
        : { happiness: clamp(c.happiness - 12), energy: clamp(c.energy - 10) } });
      await tx.relationship.updateMany({ where: { id: p.relationshipId, status: "ACTIVE" }, data: { affection: keep ? 80 : 40 } });
      return { ok: true, choice };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that option right now.", 402);
    throw e;
  }
}
