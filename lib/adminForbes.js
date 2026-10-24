// lib/adminForbes.js
// FORBES OAU administration. The ranking itself is untouched: lib/leaderboards.js still computes net worth = cash + business capital + investments and
// ranks the top 20. What an administrator controls is ELIGIBILITY.
//
//   exclude   sets Character.hideFromForbes (the flag the ranking query already honours) and writes a ForbesExclusion row (who, when, why).
//   restore   clears the flag and deletes the row.
//
// Why a removed player cannot come back by itself: the flag lives on the character, nothing in the game writes it (a search of the code finds only this
// module and the one-off database script it replaces), and the ranking is a plain query that reads it every time. Recalculating, restarting the server
// or a new week changes nothing about it. Money, businesses, investments, the character and every other board are untouched either way.
import { AdminError, REQUEST_ID, runAdminOp, reasonOf, page, paged, str, oneOf, jsonSafe } from "./adminCore.js";
import { where, orderBy, like } from "./adminSql.js";
import { getBoard, clearBoardCache, BOARDS } from "./leaderboards.js";

const ID = /^[A-Za-z0-9_-]{5,40}$/;
export const BOARD_SIZE = 20;

const BASE = `
  SELECT c.id AS "characterId", c.name, c.class::text AS class, c.graduated, f.name AS faculty, u.status AS "accountStatus", c."hideFromForbes" AS excluded,
    (a.balance::numeric + COALESCE(b.cap, 0) + COALESCE(h.inv, 0)) AS nw, a.balance::numeric AS cash, COALESCE(b.cap, 0) AS biz, COALESCE(h.inv, 0) AS inv,
    fe.reason AS "excludedReason", fe."createdAt" AS "excludedAt", fe."byAdminId" AS "excludedBy", ac.name AS "excludedByName",
    (NOT c."hideFromForbes" AND u.status <> 'DELETED') AS eligible
  FROM "Account" a JOIN "Character" c ON c.id = a."characterId" JOIN "User" u ON u.id = c."userId" JOIN "Faculty" f ON f.id = c."facultyId"
  LEFT JOIN (SELECT "characterId", SUM(capital) AS cap FROM "Business" WHERE status = 'ACTIVE' GROUP BY 1) b ON b."characterId" = c.id
  LEFT JOIN (SELECT "characterId", SUM("valueKobo") AS inv FROM "Holding" GROUP BY 1) h ON h."characterId" = c.id
  LEFT JOIN "ForbesExclusion" fe ON fe."characterId" = c.id LEFT JOIN "Character" ac ON ac."userId" = fe."byAdminId"
  WHERE a.kind = 'PLAYER'`;

// ranks use the board's own rule: net worth, highest first, equal values share a rank. `wouldBe` is where an excluded player would stand if restored.
const RANKED = `SELECT x.*, CASE WHEN x.eligible THEN RANK() OVER (PARTITION BY x.eligible ORDER BY x.nw DESC) END AS rank,
    (SELECT COUNT(*) + 1 FROM (${BASE}) y WHERE y.eligible AND y.nw > x.nw) AS "wouldBe", COUNT(*) FILTER (WHERE x.eligible) OVER () AS "eligibleCount"
  FROM (${BASE}) x`;

const SORTS = { rank: "t.nw", name: "lower(t.name)", cash: "t.cash", business: "t.biz", investments: "t.inv", excludedAt: 't."excludedAt"' };

const why = (r) => {
  if (r.accountStatus === "DELETED") return "Archived account: never listed on the board.";
  if (r.excluded) return `Excluded${r.excludedByName || r.excludedBy ? ` by ${r.excludedByName ?? r.excludedBy}` : ""}${r.excludedAt ? ` on ${new Date(r.excludedAt).toISOString().slice(0, 10)}` : ""}: ${r.excludedReason ?? "no reason recorded"}. Their money and progress are untouched. If restored they would rank #${r.wouldBe}.`;
  const rank = Number(r.rank);
  return rank <= BOARD_SIZE
    ? `On the board at #${rank} of ${r.eligibleCount} eligible players. Net worth = cash + business capital + investments (investments valued when the player last logged in).`
    : `Eligible and ranked #${rank} of ${r.eligibleCount}. The board shows only the top ${BOARD_SIZE}.`;
};

/** Every player with their Forbes standing. view: board (the top 20) | eligible | excluded | all */
export async function forbesPlayers(db, q = {}) {
  const view = oneOf(q.view, ["board", "eligible", "excluded", "all"], "board"), p = page(q), w = where();
  if (view === "board") w.add(`t.eligible AND t.rank <= ${BOARD_SIZE}`);
  else if (view === "eligible") w.add(`t.eligible`);
  else if (view === "excluded") w.add(`t.excluded`);
  const text = str(q.q, 60);
  if (text) { w.add(`(t.name ILIKE ? ESCAPE '\\' OR t."characterId" = ?)`, like(text), text); }
  const order = view === "excluded" ? orderBy(SORTS, q.sort ?? "excludedAt", q.dir ?? "desc", "t.name") : orderBy(SORTS, q.sort ?? "rank", q.dir ?? (q.sort && q.sort !== "rank" ? "desc" : "desc"), "t.name");
  const FROM = `FROM (${RANKED}) t ${w.clause()}`;
  const [rows, [n], [s]] = await Promise.all([
    db.$queryRawUnsafe(`SELECT t."characterId", t.name, t.class, t.graduated, t.faculty, t."accountStatus", t.excluded, t.nw::text AS nw, t.cash::text AS cash, t.biz::text AS biz, t.inv::text AS inv, t.rank::int AS rank,
      t."wouldBe"::int AS "wouldBe", t."eligibleCount"::int AS "eligibleCount", t."excludedReason", t."excludedAt", t."excludedBy", t."excludedByName" ${FROM} ${order} LIMIT ${p.pageSize} OFFSET ${p.offset}`, ...w.values),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n ${FROM}`, ...w.values),
    db.$queryRawUnsafe(`SELECT COUNT(*) FILTER (WHERE excluded)::int AS excluded, COUNT(*) FILTER (WHERE eligible)::int AS eligible FROM (${BASE}) z`),
  ]);
  return jsonSafe({
    ...paged(rows.map((r) => ({ ...r, nw: String(r.nw).split(".")[0], cash: String(r.cash).split(".")[0], biz: String(r.biz).split(".")[0], inv: String(r.inv).split(".")[0], why: why(r), onBoard: r.rank != null && r.rank <= BOARD_SIZE && !r.excluded })), n.n, p),
    excludedCount: s.excluded, eligibleCount: s.eligible, boardSize: BOARD_SIZE, rule: BOARDS.forbes.note,
  });
}

/** The board exactly as players see it right now (a fresh calculation: the cache is cleared first when `fresh`). */
export async function forbesBoard(db, { fresh = false } = {}) {
  if (fresh) clearBoardCache();
  const b = await getBoard(db, "forbes");
  return jsonSafe({ title: b.title, note: b.note, updatedAt: b.updatedAt, rows: b.rows });
}

export async function excludeFromForbes(db, adminId, { characterId, reason, requestId }) {
  if (!ID.test(String(characterId ?? ""))) throw new AdminError("Choose a player.");
  if (!REQUEST_ID.test(String(requestId ?? ""))) throw new AdminError("Missing requestId.");
  const why2 = reasonOf(reason);
  const r = await runAdminOp(db, adminId, { action: "FORBES:EXCLUDE", target: characterId, requestId }, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    const c = await tx.character.findUnique({ where: { id: characterId }, select: { id: true, name: true, hideFromForbes: true } });
    if (!c) throw new AdminError("No such player.", 404);
    if (c.hideFromForbes) throw new AdminError(`${c.name} is already excluded.`, 409);
    await tx.character.update({ where: { id: c.id }, data: { hideFromForbes: true } });
    await tx.forbesExclusion.upsert({ where: { characterId: c.id }, update: { reason: why2, byAdminId: adminId, createdAt: new Date() }, create: { characterId: c.id, reason: why2, byAdminId: adminId } });
    return { target: c.id, detail: { player: c.name, reason: why2, effect: "Removed from the FORBES OAU board. Money, character and progress untouched." } };
  });
  clearBoardCache();
  return r;
}

export async function restoreToForbes(db, adminId, { characterId, reason, requestId }) {
  if (!ID.test(String(characterId ?? ""))) throw new AdminError("Choose a player.");
  if (!REQUEST_ID.test(String(requestId ?? ""))) throw new AdminError("Missing requestId.");
  const why2 = reasonOf(reason);
  const r = await runAdminOp(db, adminId, { action: "FORBES:RESTORE", target: characterId, requestId }, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    const c = await tx.character.findUnique({ where: { id: characterId }, select: { id: true, name: true, hideFromForbes: true } });
    if (!c) throw new AdminError("No such player.", 404);
    if (!c.hideFromForbes) throw new AdminError(`${c.name} is not excluded.`, 409);
    await tx.character.update({ where: { id: c.id }, data: { hideFromForbes: false } });
    await tx.forbesExclusion.deleteMany({ where: { characterId: c.id } });
    return { target: c.id, detail: { player: c.name, reason: why2 } };
  });
  clearBoardCache();
  return r;
}

/** Recalculate the board now, with the game's own rules, and say what it shows. */
export async function recalculateForbes(db, adminId, { requestId }) {
  if (!REQUEST_ID.test(String(requestId ?? ""))) throw new AdminError("Missing requestId.");
  let board;
  const r = await runAdminOp(db, adminId, { action: "FORBES:REFRESH", requestId }, async () => {
    clearBoardCache(); board = await getBoard(db, "forbes");
    return { detail: { top: board.rows.slice(0, 3).map((x) => x.name), listed: board.rows.length } };
  });
  return { ...r, board: r.duplicate ? undefined : jsonSafe({ updatedAt: board?.updatedAt, rows: board?.rows }) };
}
