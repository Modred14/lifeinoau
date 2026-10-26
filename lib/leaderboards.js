// lib/leaderboards.js
// Leaderboards are computed from stored data only (ledger, exams, action log). Top lists are cached 60s per server instance.
import { refreshHoldingValues } from "./marketLive.js";
import { TYPES } from "./business.js";
const TTL = 60_000, TOP = 20, cache = new Map(), running = new Map();
export const BOARDS = {
  forbes:   { title: "FORBES OAU", note: "Net worth = cash + savings + business capital + investments (valued at live prices, refreshed every few minutes)." },
  cgpa:     { title: "Highest CGPA", note: "Players need at least 2 exams." },
  popular:  { title: "Most Popular" },
  party:    { title: "Biggest Party Animal", note: "Counted by tickets bought across 0203, Royal Divas and Quantum." },
  hustler:  { title: "Most Successful Hustler", note: "Total earned from safe and risky hustles." },
  business: { title: "Best Business", note: "Ranked by the capital a business holds." },
};

/** Competition ranking: equal values share a rank (1, 2, 2, 4). Rows must already be sorted best-first. */
export function rankRows(rows) {
  let rank = 0, prev;
  return rows.map((r, i) => { if (r.value !== prev) { rank = i + 1; prev = r.value; } return { ...r, rank }; });
}
const who = (ch) => ({ name: ch.name, class: ch.class, faculty: ch.faculty?.name ?? null, graduated: !!ch.graduated });
const CH = { name: true, class: true, graduated: true, faculty: { select: { name: true } } };
async function people(db, ids) { const rows = await db.character.findMany({ where: { id: { in: ids }, user: { status: { not: "DELETED" } } }, select: { id: true, ...CH } }); return new Map(rows.map((c) => [c.id, c])); }

const QUERIES = {
  async forbes(db) {
    if (globalThis.db) await refreshHoldingValues(db).catch(() => {}); // investments are priced live: re-value stored holdings first (one statement, at most every 2 minutes)
    // Net worth is summed as NUMERIC and returned as exact text: a balance near the largest amount the database can hold plus business capital would overflow a bigint cast,
    // and that would break the whole board for everyone. Sorting is numeric (never on the text).
    // Net worth = cash + savings + business capital + investments (lib/bankRules.js netWorthOf). `cash` here is the money in the bank: the wallet plus the savings.
    const rows = await db.$queryRaw`SELECT t.name, t.class, t.graduated, t.faculty, t.nwn::text AS nw, t.cash::text AS cash, t.sav::text AS sav, t.biz::text AS biz, t.inv::text AS inv FROM (
      SELECT c.name, c.class::text AS class, c.graduated, f.name AS faculty, (a.balance::numeric + COALESCE(sv.balance, 0) + COALESCE(b.cap, 0) + COALESCE(h.inv, 0)) AS nwn, (a.balance::numeric + COALESCE(sv.balance, 0)) AS cash, COALESCE(sv.balance, 0) AS sav, COALESCE(b.cap, 0) AS biz, COALESCE(h.inv, 0) AS inv
      FROM "Account" a JOIN "Character" c ON c.id = a."characterId" JOIN "User" u ON u.id = c."userId" JOIN "Faculty" f ON f.id = c."facultyId"
      LEFT JOIN "SavingsAccount" sv ON sv."characterId" = c.id
      LEFT JOIN (SELECT "characterId", SUM(capital) AS cap FROM "Business" WHERE status = 'ACTIVE' GROUP BY 1) b ON b."characterId" = c.id
      LEFT JOIN (SELECT "characterId", SUM("valueKobo") AS inv FROM "Holding" GROUP BY 1) h ON h."characterId" = c.id
      WHERE a.kind = 'PLAYER' AND NOT c."hideFromForbes" AND u.status <> 'DELETED') t ORDER BY t.nwn DESC, t.name ASC LIMIT 20`;
    return rows.map((r) => ({ name: r.name, class: r.class, faculty: r.faculty, graduated: !!r.graduated, value: r.nw.toString(), money: true, cash: r.cash.toString(), savingsIncluded: (r.sav ?? "0").toString(), business: r.biz.toString(), investments: r.inv.toString() }));
  },
  async business(db) {
    const rows = await db.business.findMany({ where: { status: "ACTIVE", character: { user: { status: { not: "DELETED" } } } }, orderBy: { capital: "desc" }, take: TOP, select: { name: true, type: true, capital: true, character: { select: CH } } });
    return rows.map((r) => ({ ...who(r.character), value: r.capital.toString(), money: true, sub: `${r.name} · ${TYPES[r.type].label}` }));
  },
  async cgpa(db) {
    // Same rule as the player's own CGPA (lib/gameService.js getState): only results since their last restart (after an expulsion) count.
    // A plain groupBy cannot see Character.restartWeek, so the join is done in SQL. Two results at least, ties broken by name so the order is stable.
    const g = await db.$queryRaw`SELECT e."characterId" AS id, AVG(e."gradePoint")::float8 AS avg FROM "ExamResult" e JOIN "Character" c ON c.id = e."characterId"
      WHERE e."gameWeek" >= c."restartWeek" GROUP BY e."characterId", c.name HAVING COUNT(*) >= 2 ORDER BY AVG(e."gradePoint") DESC, c.name ASC LIMIT ${TOP}`;
    const p = await people(db, g.map((x) => x.id));
    return g.filter((x) => p.has(x.id)).map((x) => ({ ...who(p.get(x.id)), value: (Math.round(x.avg * 100) / 100).toFixed(2) }));
  },
  async popular(db) {
    const rows = await db.character.findMany({ where: { user: { status: { not: "DELETED" } } }, orderBy: [{ popularity: "desc" }, { createdAt: "asc" }], take: TOP, select: { popularity: true, ...CH } });
    return rows.map((c) => ({ ...who(c), value: String(c.popularity) }));
  },
  async party(db) {
    const g = await db.partyTicket.groupBy({ by: ["characterId"], _count: { _all: true }, orderBy: { _count: { characterId: "desc" } }, take: TOP });
    const p = await people(db, g.map((x) => x.characterId));
    return g.filter((x) => p.has(x.characterId)).map((x) => ({ ...who(p.get(x.characterId)), value: String(x._count._all) }));
  },
  async hustler(db) {
    const g = await db.ledgerEntry.groupBy({ by: ["creditAccountId"], where: { memo: { in: ["Safe hustle", "Risky hustle"] } }, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } }, take: TOP });
    const accs = await db.account.findMany({ where: { id: { in: g.map((x) => x.creditAccountId) }, character: { user: { status: { not: "DELETED" } } } }, select: { id: true, character: { select: CH } } });
    const m = new Map(accs.map((a) => [a.id, a.character]));
    return g.filter((x) => m.get(x.creditAccountId)).map((x) => ({ ...who(m.get(x.creditAccountId)), value: x._sum.amount.toString(), money: true }));
  },
};

export async function getBoard(db, key, now = Date.now()) {
  const def = BOARDS[key]; if (!def) return null;
  if (def.unavailable) return { key, title: def.title, unavailable: def.unavailable, rows: [] };
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) return hit.data;
  if (running.has(key)) return running.get(key); // a refresh is already running: wait for it instead of starting another heavy query
  const p = (async () => {
    const raw = await QUERIES[key](db);
    const data = { key, title: def.title, note: def.note ?? null, updatedAt: new Date(now).toISOString(), rows: rankRows(raw) };
    cache.set(key, { at: now, data }); return data;
  })().finally(() => running.delete(key));
  running.set(key, p); return p;
}
export const clearBoardCache = () => { cache.clear(); running.clear(); };