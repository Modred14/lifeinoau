// lib/achievementService.js
import { ACHIEVEMENTS, evaluate, titleOf } from "./achievements.js";
import { cgpa } from "./engine.js";

const lastSync = new Map(); // characterId -> when we last checked
/** Tell the next syncAchievements() call to really check (cash or stats just changed). */
export const markAchievementsDirty = (characterId) => { lastSync.delete(characterId); };

/** Check the player against every rule and record anything new. Safe to call often: a unique key makes each award happen once.
 *  The check costs nine queries, so with { maxAgeMs } a player who was checked that recently is skipped (default: always check). */
export async function syncAchievements(db, characterId, week, { maxAgeMs = 0 } = {}) {
  if (maxAgeMs > 0) {
    const now = Date.now();
    if (now - (lastSync.get(characterId) ?? 0) < maxAgeMs) return [];
    if (lastSync.size > 20_000) lastSync.clear();
    lastSync.set(characterId, now);
  }
  const c = await db.character.findUnique({ where: { id: characterId }, include: { account: true } });
  if (!c) return [];
  const [have, tickets, dated, arrests, exams, bizEver, techEver, bizActive] = await Promise.all([
    db.achievement.findMany({ where: { characterId }, select: { key: true } }),
    db.partyTicket.count({ where: { characterId } }),
    db.relationship.count({ where: { characterId, stage: "DATING" } }),
    db.floorZero.count({ where: { characterId } }),
    db.examResult.findMany({ where: { characterId }, select: { gradePoint: true } }),
    db.business.count({ where: { characterId } }), db.business.count({ where: { characterId, type: "TECH" } }), db.business.count({ where: { characterId, status: "ACTIVE" } })]);
  const earned = new Set(have.map((h) => h.key));
  const snap = { cash: c.account.balance, class: c.class, graduated: c.graduated, classification: c.classification, popularity: c.popularity,
    tickets, bizEver, techEver, bizActive, datedStage: dated > 0, arrests, exams: exams.length, cgpa: cgpa(exams.map((e) => e.gradePoint)) ?? 0 };
  const fresh = [];
  for (const key of evaluate(snap).filter((k) => !earned.has(k))) {
    try {
      await db.achievement.create({ data: { characterId, key, earnedWeek: week } });
      const def = ACHIEVEMENTS.find((a) => a.key === key);
      await db.notification.create({ data: { characterId, kind: "ACHIEVEMENT", body: `🏆 Achievement unlocked: ${titleOf(def, c.gender)}` } });
      fresh.push(key);
    } catch (e) { if (e.code !== "P2002") throw e; } // another request got there first
  }
  return fresh;
}

export async function listAchievements(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true, gender: true } });
  if (!c) return null;
  const rows = await db.achievement.findMany({ where: { characterId: c.id } }), got = new Map(rows.map((r) => [r.key, r.earnedWeek]));
  return ACHIEVEMENTS.map((a) => ({ key: a.key, title: titleOf(a, c.gender), text: a.text, earned: got.has(a.key), earnedWeek: got.get(a.key) ?? null, unavailable: a.unavailable ?? null }));
}
export const earnedTitles = async (db, characterId, gender) =>
  (await db.achievement.findMany({ where: { characterId }, orderBy: { earnedWeek: "asc" } })).map((r) => titleOf(ACHIEVEMENTS.find((a) => a.key === r.key), gender));