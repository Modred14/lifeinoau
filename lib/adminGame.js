// lib/adminGame.js
// Administration of the game's own systems. Only systems that exist in this repository are here, each read from its real tables, and every change
// goes through the same rules the game uses (the ledger for money, the match service for refunds, the game's own catalogs for items and cars).
//
//   gameOverview   one count per system, for the Game page
//   gameList       a paged, filterable list for one view of one system (see VIEWS)
//   gameAction     the few changes an administrator may make, each with a reason, an audit row and a request id
//   gameRules      the rules and prices the game runs on (they live in code: this is a faithful READ-ONLY view, see the note on `config`)
import { AdminError, REQUEST_ID, runAdminOp, reasonOf, page, paged, str, int, oneOf, jsonSafe } from "./adminCore.js";
import { where, orderBy, like, NOW } from "./adminSql.js";
import { transferInTx } from "./ledger.js";
import { currentWeek } from "./clock.js";
import { voidMatchInTx } from "./games/matchService.js";
import { JOBS, SHIFT_TYPES, MAX_SHIFTS_PER_WEEK, MAX_JOB_LEVEL, SHIFTS_PER_LEVEL, jobLevel } from "./jobs.js";
import { TYPES as BUSINESS_TYPES, MAX_EMPLOYEES, MAX_LEVEL as BUSINESS_MAX_LEVEL } from "./business.js";
import { ITEMS, isItem, MAX_ITEMS, SELL_PERCENT } from "./furniture.js";
import { CARS, carById, CAR_PAINTS } from "./cars.js";
import { CLUBS, DRINKS, PACKAGES, BUYOUT_TIERS, MIN_SPEND, MAX_SPEND, HOURS_LABEL } from "./clubs.js";
import { FARE_NAIRA, DRIVER_PLANS } from "./travel.js";
import { SUSPENSION_MS, EXPULSION_MS, RESTART_LEVEL } from "./discipline.js";
import { STARTING_ALLOWANCE, SESSION_WEEKS, P2P } from "./rules.js";
import { HUSTLE } from "./engine.js";
import { GAME_LIST } from "./games/index.js";
import { MIN_STAKE, MAX_STAKE, MAX_LEGS } from "./bet/markets.js";
import { MAX_STAKE as AVIATOR_MAX } from "./bet/aviatorMath.js";
import { MAX_STAKE as ROULETTE_MAX } from "./bet/rouletteMath.js";
import { placeName } from "./adminPlaces.js";

export const SYSTEMS = [
  { id: "academics", title: "Academics", blurb: "Faculties, exams, class tests, academic standing" },
  { id: "jobs", title: "Jobs", blurb: "Job definitions, employment, shifts" },
  { id: "businesses", title: "Businesses", blurb: "Every business, its owner and capital" },
  { id: "hostels", title: "Hostels & homes", blurb: "Occupancy and residents" },
  { id: "relationships", title: "Relationships", blurb: "Player bonds and NPC relationships" },
  { id: "events", title: "Nightclubs & parties", blurb: "Club spending, VIPs, buyouts, party tickets" },
  { id: "inventory", title: "Items & cars", blurb: "Room items and owned cars, with adjustments" },
  { id: "transport", title: "Transport", blurb: "Cars sold, rides, drivers" },
  { id: "hustles", title: "Hustles & custody", blurb: "Hustle runs, catches, Floor O custody" },
  { id: "matches", title: "Games & wagers", blurb: "Matches, wagers and the matchmaking queue" },
  { id: "billboards", title: "Billboards", blurb: "Posters, with the admin switch-off" },
  { id: "elections", title: "SUG elections", blurb: "Elections, candidates, results" },
  { id: "config", title: "Game rules", blurb: "Prices, rewards, cooldowns and limits the game runs on" },
];

const N = (v) => (v == null ? "0" : String(v).split(".")[0]);
const ID = /^[A-Za-z0-9_-]{5,40}$/;
const bigId = (v, what = "Id") => { if (!/^\d{1,18}$/.test(String(v ?? ""))) throw new AdminError(`${what} is not valid.`); return BigInt(v); };

async function list(db, { select, from, w, order, p, count = "COUNT(*)::int" }) {
  const [rows, [n]] = await Promise.all([
    db.$queryRawUnsafe(`SELECT ${select} ${from} ${w.clause()} ${order} LIMIT ${p.pageSize} OFFSET ${p.offset}`, ...w.values),
    db.$queryRawUnsafe(`SELECT ${count} AS n ${from} ${w.clause()}`, ...w.values),
  ]);
  return { rows, total: n.n, p };
}
const done = (r) => jsonSafe(paged(r.rows, r.total, r.p));
const search = (w, q, cols) => { const t = str(q.q, 60); if (t) { const lk = like(t); w.add(`(${cols.map(() => "? IS NOT NULL AND false").join("")}false)`); } };
const nameSearch = (w, q, col = "c.name") => { const t = str(q.q, 60); if (t) w.add(`(${col} ILIKE ? ESCAPE '\\' OR c.id = ?)`, like(t), t); };

// ---------------------------------------------------------------- overview
export async function gameOverview(db) {
  const week = await currentWeek(db);
  const [r] = await db.$queryRawUnsafe(`SELECT
    (SELECT COUNT(*) FROM "Character")::int AS players, (SELECT COUNT(*) FROM "Character" WHERE graduated)::int AS graduates,
    (SELECT COUNT(*) FROM "Character" WHERE "jobKey" IS NOT NULL)::int AS employed, (SELECT COUNT(*) FROM "JobShift" WHERE status = 'ACTIVE')::int AS "activeShifts",
    (SELECT COUNT(*) FROM "Business" WHERE status = 'ACTIVE')::int AS "activeBusinesses", (SELECT COALESCE(SUM(capital), 0) FROM "Business" WHERE status = 'ACTIVE')::text AS "businessCapital",
    (SELECT COUNT(*) FROM "ExamResult")::int AS exams, (SELECT COUNT(*) FROM "ClassTest" WHERE status = 'PENDING')::int AS "pendingTests",
    (SELECT COUNT(*) FROM "Character" WHERE hostel <> '')::int AS housed, (SELECT COUNT(*) FROM "Bond" WHERE kind <> 'EX')::int AS "liveBonds", (SELECT COUNT(*) FROM "Relationship" WHERE status = 'ACTIVE')::int AS "npcRelationships",
    (SELECT COUNT(*) FROM "ClubTransaction")::int AS "clubTransactions", (SELECT COALESCE(SUM(amount), 0) FROM "ClubTransaction")::text AS "clubSpend", (SELECT COUNT(*) FROM "PartyTicket")::int AS "partyTickets",
    (SELECT COUNT(*) FROM "RoomItem")::int AS "roomItems", (SELECT COUNT(*) FROM "OwnedCar")::int AS "ownedCars", (SELECT COUNT(*) FROM "HustleRun")::int AS "hustleRuns",
    (SELECT COUNT(*) FROM "FloorZero" WHERE status = 'JAILED')::int AS "inCustody", (SELECT COUNT(*) FROM "GameMatch" WHERE status = 'ACTIVE')::int AS "activeMatches", (SELECT COUNT(*) FROM "GameQueue")::int AS queued,
    (SELECT COUNT(*) FROM "BillboardSlot" WHERE status = 'PAID')::int AS billboards, (SELECT COUNT(*) FROM "SugCycle" WHERE status = 'LIVE')::int AS "liveElections", (SELECT COUNT(*) FROM "Report" WHERE status = 'OPEN')::int AS "openReports"`);
  return jsonSafe({ week, ...r });
}

// ---------------------------------------------------------------- lists
const stakeOf = (r) => ({ ...r });

export const VIEWS = {
  "jobs.definitions": async (db) => {
    const [emp, sh] = await Promise.all([
      db.$queryRawUnsafe(`SELECT "jobKey" AS k, COUNT(*)::int AS n, ROUND(AVG("jobXp"))::int AS xp FROM "Character" WHERE "jobKey" IS NOT NULL GROUP BY 1`),
      db.$queryRawUnsafe(`SELECT "jobKey" AS k, COUNT(*)::int AS n, COALESCE(SUM("payKobo") FILTER (WHERE status = 'CLAIMED'), 0)::text AS paid FROM "JobShift" WHERE "startedAt" > ${NOW} - interval '7 days' GROUP BY 1`),
    ]);
    const e = new Map(emp.map((x) => [x.k, x])), s = new Map(sh.map((x) => [x.k, x]));
    const rows = Object.entries(JOBS).map(([key, j]) => ({ key, title: j.title, minLevel: j.minLevel, payNaira: j.pay, energy: j.energy, shifts: j.shifts, hours: j.hours, faculties: j.faculties ?? null, employed: e.get(key)?.n ?? 0, avgXp: e.get(key)?.xp ?? 0, shiftsThisWeek: s.get(key)?.n ?? 0, paidThisWeekKobo: s.get(key)?.paid ?? "0" }));
    return jsonSafe({ rows, total: rows.length, page: 1, pageSize: rows.length, pages: 1, note: `Jobs are defined in code (lib/jobs.js). A player can work up to ${MAX_SHIFTS_PER_WEEK} shifts a week; a job level is one per ${SHIFTS_PER_LEVEL} shifts, to level ${MAX_JOB_LEVEL}.` });
  },
  "jobs.employment": async (db, q) => {
    const p = page(q), w = where().add(`c."jobKey" IS NOT NULL`); nameSearch(w, q);
    const k = str(q.job, 40); if (k) w.add(`c."jobKey" = ?`, k);
    const r = await list(db, { select: `c.id AS "characterId", c.name, c.level, c."jobKey", c."jobXp", f.name AS faculty`, from: `FROM "Character" c JOIN "Faculty" f ON f.id = c."facultyId"`, w, order: orderBy({ xp: 'c."jobXp"', name: "lower(c.name)" }, q.sort, q.dir ?? "desc", "c.id"), p });
    return done({ ...r, rows: r.rows.map((x) => ({ ...x, jobTitle: JOBS[x.jobKey]?.title ?? x.jobKey, jobLevel: jobLevel(x.jobXp) })) });
  },
  "jobs.shifts": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q);
    const st = oneOf(q.status, ["ACTIVE", "CLAIMED", "ABANDONED"]); if (st) w.add(`s.status = ?`, st);
    const k = str(q.job, 40); if (k) w.add(`s."jobKey" = ?`, k);
    return done(await list(db, { select: `s.id, c.id AS "characterId", c.name, s."jobKey", s."shiftKey", s.status, s."payKobo"::text AS pay, s."startedAt", s."endsAt"`, from: `FROM "JobShift" s JOIN "Character" c ON c.id = s."characterId"`, w, order: orderBy({ startedAt: 's."startedAt"', pay: 's."payKobo"' }, q.sort, q.dir ?? "desc", "s.id DESC"), p }));
  },
  businesses: async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q, "(b.name || ' ' || c.name)");
    const st = oneOf(q.status, ["ACTIVE", "CLOSED", "BANKRUPT"]); if (st) w.add(`b.status = ?`, st);
    const ty = oneOf(q.type, Object.keys(BUSINESS_TYPES)); if (ty) w.add(`b.type = ?`, ty);
    const r = await list(db, { select: `b.id, b.name, b.type, b.level, b.employees, b.reputation, b.capital::text AS capital, b.status, b."startedWeek", c.id AS "ownerId", c.name AS owner`, from: `FROM "Business" b JOIN "Character" c ON c.id = b."characterId"`, w, order: orderBy({ capital: "b.capital", name: "lower(b.name)", level: "b.level" }, q.sort, q.dir ?? "desc", "b.id DESC"), p });
    const [t] = await db.$queryRawUnsafe(`SELECT COALESCE(SUM(capital) FILTER (WHERE status = 'ACTIVE'), 0)::text AS capital, COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active FROM "Business"`);
    return jsonSafe({ ...paged(r.rows.map((x) => ({ ...x, id: String(x.id), typeLabel: BUSINESS_TYPES[x.type]?.label ?? x.type })), r.total, p), summary: t, types: Object.fromEntries(Object.entries(BUSINESS_TYPES).map(([k, v]) => [k, v.label])) });
  },
  "academics.faculties": async (db) => {
    const rows = await db.$queryRawUnsafe(`SELECT f.id, f.name, f.difficulty::text AS difficulty, f.verified, COUNT(c.id)::int AS players, ROUND(AVG(c.level))::int AS "avgLevel", COUNT(c.id) FILTER (WHERE c.graduated)::int AS graduates FROM "Faculty" f LEFT JOIN "Character" c ON c."facultyId" = f.id GROUP BY f.id ORDER BY f.name`);
    return jsonSafe({ rows, total: rows.length, page: 1, pageSize: rows.length, pages: 1, note: "Difficulty feeds the course and exam engine live: raising it makes that faculty's courses harder for every student from their next action." });
  },
  "academics.exams": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q);
    if (q.caught === "1") w.add(`e.caught`); if (q.cheated === "1") w.add(`e.cheated`); if (q.missed === "1") w.add(`e.missed`);
    const wk = int(q.week, { min: 0, max: 100000 }); if (wk != null) w.add(`e."gameWeek" = ?::int`, wk);
    return done(await list(db, { select: `e.id, c.id AS "characterId", c.name, e."gameWeek", e.level, e.score, e."gradePoint", e.cheated, e.caught, e.missed`, from: `FROM "ExamResult" e JOIN "Character" c ON c.id = e."characterId"`, w, order: orderBy({ week: 'e."gameWeek"', score: "e.score", name: "lower(c.name)" }, q.sort, q.dir ?? "desc", "e.id DESC"), p }));
  },
  "academics.tests": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q);
    const st = oneOf(q.status, ["PENDING", "TAKEN", "MISSED"]); if (st) w.add(`t.status = ?`, st);
    return done(await list(db, { select: `t.id, c.id AS "characterId", c.name, t.code, t."gameWeek", t.status, t.score, t."takenAt"`, from: `FROM "ClassTest" t JOIN "Character" c ON c.id = t."characterId"`, w, order: orderBy({ week: 't."gameWeek"', score: "t.score" }, q.sort, q.dir ?? "desc", "t.id DESC"), p }));
  },
  "academics.status": async (db) => {
    const [byLevel, st] = await Promise.all([
      db.$queryRawUnsafe(`SELECT level, COUNT(*)::int AS players FROM "Character" WHERE NOT graduated GROUP BY 1 ORDER BY 1`),
      db.$queryRawUnsafe(`SELECT COUNT(*) FILTER (WHERE graduated)::int AS graduated, COUNT(*) FILTER (WHERE "suspendedUntil" > ${NOW})::int AS suspended, COUNT(*) FILTER (WHERE expelled AND ("expelledUntil" IS NULL OR "expelledUntil" > ${NOW}))::int AS expelled,
        COUNT(*) FILTER (WHERE "failedSessions" > 0)::int AS "failedSessions", COUNT(*) FILTER (WHERE strikes > 0)::int AS "withStrikes", ROUND(AVG(academics))::int AS "avgAcademics" FROM "Character"`),
    ]);
    return jsonSafe({ byLevel, ...st[0] });
  },
  "hostels.occupancy": async (db) => {
    const rows = await db.$queryRawUnsafe(`SELECT hostel, COUNT(*)::int AS players, COUNT(*) FILTER (WHERE gender = 'M')::int AS male, COUNT(*) FILTER (WHERE gender = 'F')::int AS female FROM "Character" WHERE hostel <> '' GROUP BY 1 ORDER BY players DESC`);
    const [n] = await db.$queryRawUnsafe(`SELECT COUNT(*) FILTER (WHERE hostel = '')::int AS unhoused FROM "Character"`);
    return jsonSafe({ rows, total: rows.length, page: 1, pageSize: rows.length, pages: 1, unhoused: n.unhoused });
  },
  "hostels.residents": async (db, q) => {
    const p = page(q), w = where().add(`c.hostel <> ''`); nameSearch(w, q);
    const h = str(q.hostel, 40); if (h) w.add(`c.hostel = ?`, h);
    return done(await list(db, { select: `c.id AS "characterId", c.name, c.hostel, c.gender::text AS gender, c.level, c."rentPaidUntilWeek"`, from: `FROM "Character" c`, w, order: orderBy({ name: "lower(c.name)", hostel: "c.hostel" }, q.sort, q.dir ?? "asc", "c.id"), p }));
  },
  "relationships.bonds": async (db, q) => {
    const p = page(q), w = where(); const t = str(q.q, 60); if (t) w.add(`(lo.name ILIKE ? ESCAPE '\\' OR hi.name ILIKE ? ESCAPE '\\')`, like(t), like(t));
    const k = oneOf(q.kind, ["TALKING", "BESTIE", "SNEAKY", "BABE", "ENGAGED", "EX"]); if (k) w.add(`b.kind = ?`, k);
    const r = await list(db, { select: `b.id, b.kind, b.affection, b."startedWeek", b."endedWeek", b.together, b."homeHostel", b.dates, lo.id AS "lowId", lo.name AS "lowName", hi.id AS "highId", hi.name AS "highName"`, from: `FROM "Bond" b JOIN "Character" lo ON lo.id = b."lowId" JOIN "Character" hi ON hi.id = b."highId"`, w, order: orderBy({ affection: "b.affection", started: 'b."startedWeek"' }, q.sort, q.dir ?? "desc", "b.id DESC"), p });
    return done({ ...r, rows: r.rows.map((x) => ({ ...x, id: String(x.id) })) });
  },
  "relationships.npc": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q);
    const st = oneOf(q.status, ["ACTIVE", "ENDED"]); if (st) w.add(`r.status = ?::"RelStatus"`, st);
    const r = await list(db, { select: `r.id, c.id AS "characterId", c.name, r."npcName", r.stage, r.affection, r.status::text AS status, r."startedWeek"`, from: `FROM "Relationship" r JOIN "Character" c ON c.id = r."characterId"`, w, order: orderBy({ affection: "r.affection" }, q.sort, q.dir ?? "desc", "r.id DESC"), p });
    return done({ ...r, rows: r.rows.map((x) => ({ ...x, id: String(x.id) })) });
  },
  "events.clubs": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q);
    const club = oneOf(q.club, Object.keys(CLUBS)); if (club) w.add(`t."clubId" = ?`, club);
    const kind = oneOf(q.kind, ["SPRAY", "DRINK", "GIFT_DRINK", "PACKAGE", "BUYOUT", "EXPERIENCE"]); if (kind) w.add(`t.kind = ?`, kind);
    const r = await list(db, { select: `t.id, c.id AS "characterId", c.name, t."clubId", t.kind, t."itemName", t.amount::text AS amount, t.status, t."createdAt"`, from: `FROM "ClubTransaction" t JOIN "Character" c ON c.id = t."characterId"`, w, order: orderBy({ createdAt: 't."createdAt"', amount: "t.amount" }, q.sort, q.dir ?? "desc", "t.id DESC"), p });
    const totals = await db.$queryRawUnsafe(`SELECT "clubId", COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS sum, COUNT(DISTINCT "characterId")::int AS guests FROM "ClubTransaction" GROUP BY 1 ORDER BY 1`);
    return jsonSafe({ ...paged(r.rows.map((x) => ({ ...x, id: String(x.id), club: CLUBS[x.clubId]?.name ?? x.clubId })), r.total, p), totals: totals.map((x) => ({ ...x, club: CLUBS[x.clubId]?.name ?? x.clubId })), clubs: Object.fromEntries(Object.entries(CLUBS).map(([k, v]) => [k, v.name])) });
  },
  "events.tickets": async (db) => {
    const rows = await db.$queryRawUnsafe(`SELECT venue, "gameWeek", COUNT(*)::int AS tickets, COALESCE(SUM("pricePaid"), 0)::text AS revenue FROM "PartyTicket" GROUP BY 1, 2 ORDER BY "gameWeek" DESC, venue LIMIT 60`);
    const [v] = await db.$queryRawUnsafe(`SELECT (SELECT COUNT(*) FROM "ClubVip" WHERE until > ${NOW})::int AS vips, (SELECT COUNT(*) FROM "ClubBuyout" WHERE "endsAt" > ${NOW})::int AS buyouts`);
    return jsonSafe({ rows, total: rows.length, page: 1, pageSize: rows.length, pages: 1, ...v });
  },
  "inventory.items": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q);
    const k = str(q.key, 60); if (k) w.add(`i.key = ?`, k);
    const r = await list(db, { select: `i.id, c.id AS "characterId", c.name, i.key, i.placed, i.paid::text AS paid, i."createdAt"`, from: `FROM "RoomItem" i JOIN "Character" c ON c.id = i."characterId"`, w, order: orderBy({ createdAt: 'i."createdAt"', paid: "i.paid" }, q.sort, q.dir ?? "desc", "i.id DESC"), p });
    return jsonSafe({ ...paged(r.rows.map((x) => ({ ...x, id: String(x.id), itemName: ITEMS[x.key]?.name ?? x.key })), r.total, p), catalog: Object.entries(ITEMS).map(([key, v]) => ({ key, name: v.name, priceNaira: v.price })) });
  },
  "inventory.cars": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q);
    const m = str(q.model, 60); if (m) w.add(`o."modelId" = ?`, m);
    const r = await list(db, { select: `o.id, c.id AS "characterId", c.name, o."modelId", o.color, o."pricePaid"::text AS paid, o."createdAt", (c."activeCar" = o."modelId") AS active`, from: `FROM "OwnedCar" o JOIN "Character" c ON c.id = o."characterId"`, w, order: orderBy({ createdAt: 'o."createdAt"', paid: 'o."pricePaid"' }, q.sort, q.dir ?? "desc", "o.id DESC"), p });
    return jsonSafe({ ...paged(r.rows.map((x) => ({ ...x, id: String(x.id), carName: carById(x.modelId)?.name ?? x.modelId })), r.total, p), catalog: CARS.map((c) => ({ id: c.id, name: c.name, priceNaira: c.priceNaira ?? null })), paints: CAR_PAINTS.map((x) => x.id) });
  },
  "transport.overview": async (db) => {
    const week = await currentWeek(db);
    const [sold, modes, drivers, fares] = await Promise.all([
      db.$queryRawUnsafe(`SELECT "modelId", COUNT(*)::int AS n, COALESCE(SUM("pricePaid"), 0)::text AS revenue FROM "OwnedCar" GROUP BY 1 ORDER BY n DESC`),
      db.$queryRawUnsafe(`SELECT transport, COUNT(*)::int AS players FROM "Character" GROUP BY 1 ORDER BY 2 DESC`),
      db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Character" WHERE "driverName" <> '' AND "driverUntilWeek" >= $1`, week),
      db.$queryRawUnsafe(`SELECT memo, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS sum FROM "LedgerEntry" WHERE memo IN ('Keke fare', 'Bus fare', 'Car fuel') AND "createdAt" > ${NOW} - interval '7 days' GROUP BY 1`),
    ]);
    return jsonSafe({ sold: sold.map((x) => ({ ...x, car: carById(x.modelId)?.name ?? x.modelId })), modes, activeDrivers: drivers[0].n, faresThisWeek: fares, fares: FARE_NAIRA, driverPlans: DRIVER_PLANS });
  },
  "hustles.runs": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q);
    const st = oneOf(q.status, ["ACTIVE", "DONE", "ABANDONED"]); if (st) w.add(`h.status = ?`, st);
    if (q.caught === "1") w.add(`h.caught`);
    const r = await list(db, { select: `h.id, c.id AS "characterId", c.name, h.kind, h."placeId", h.status, h.caught, h."payKobo"::text AS pay, h."startedAt"`, from: `FROM "HustleRun" h JOIN "Character" c ON c.id = h."characterId"`, w, order: orderBy({ startedAt: 'h."startedAt"', pay: 'h."payKobo"' }, q.sort, q.dir ?? "desc", "h.id DESC"), p });
    const [s] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS runs, COUNT(*) FILTER (WHERE caught)::int AS caught, COALESCE(SUM("payKobo") FILTER (WHERE status = 'DONE' AND NOT caught), 0)::text AS paid FROM "HustleRun" WHERE "startedAt" > ${NOW} - interval '7 days'`);
    return jsonSafe({ ...paged(r.rows.map((x) => ({ ...x, id: String(x.id), place: placeName(x.placeId) })), r.total, p), summary: s });
  },
  "hustles.custody": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q);
    const st = oneOf(q.status, ["JAILED", "PAID", "SERVED"]); if (st) w.add(`f.status = ?::"JailStatus"`, st);
    const r = await list(db, { select: `f.id, c.id AS "characterId", c.name, f.reason, f.status::text AS status, f."startedAt", f."releaseAt", f.bill::text AS bill`, from: `FROM "FloorZero" f JOIN "Character" c ON c.id = f."characterId"`, w, order: orderBy({ startedAt: 'f."startedAt"', bill: "f.bill" }, q.sort, q.dir ?? "desc", "f.id DESC"), p });
    return done({ ...r, rows: r.rows.map((x) => ({ ...x, id: String(x.id) })) });
  },
  "matches.list": async (db, q) => {
    const p = page(q), w = where(); const t = str(q.q, 60); if (t) w.add(`(h.name ILIKE ? ESCAPE '\\' OR g.name ILIKE ? ESCAPE '\\')`, like(t), like(t));
    const st = oneOf(q.status, ["INVITED", "ACTIVE", "FINISHED", "VOID", "CANCELLED"]); if (st) w.add(`m.status = ?`, st);
    const gm = oneOf(q.game, GAME_LIST.map((x) => x.id)); if (gm) w.add(`m.game = ?`, gm);
    const r = await list(db, { select: `m.id, m.game, m.mode, m.status, m."stakeKobo"::text AS stake, m."winnerSeat", m.result, m.reason, m."createdAt", m."startedAt", m."finishedAt", h.id AS "hostId", h.name AS host, g.id AS "guestId", g.name AS guest`, from: `FROM "GameMatch" m JOIN "Character" h ON h.id = m."hostId" JOIN "Character" g ON g.id = m."guestId"`, w, order: orderBy({ createdAt: 'm."createdAt"', stake: 'm."stakeKobo"' }, q.sort, q.dir ?? "desc", "m.id DESC"), p });
    const [s] = await db.$queryRawUnsafe(`SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active, (SELECT COUNT(*) FROM "GameQueue")::int AS queued, COALESCE(SUM("stakeKobo" * 2) FILTER (WHERE status = 'ACTIVE'), 0)::text AS escrow, COALESCE(SUM("payoutKobo"), 0)::text AS paid FROM "GameMatch"`);
    return jsonSafe({ ...paged(r.rows.map((x) => ({ ...x, id: String(x.id), winner: x.winnerSeat == null ? null : x.winnerSeat === 0 ? x.host : x.guest })), r.total, p), summary: s, games: GAME_LIST.map((x) => ({ id: x.id, name: x.name })) });
  },
  "billboards.list": async (db, q) => {
    const p = page(q), w = where(); nameSearch(w, q, "COALESCE(c.name, '')");
    const st = oneOf(q.status, ["PENDING", "PAID"]); if (st) w.add(`b.status = ?::"BillboardStatus"`, st);
    if (q.hidden === "1") w.add(`b.hidden`);
    return done(await list(db, { select: `b.id, b.board, b.slot, b.scope, b.status::text AS status, b."amountKobo"::text AS amount, b.caption, b.hidden, (b.image IS NOT NULL) AS "hasImage", b."paidAt", c.id AS "ownerId", c.name AS owner`, from: `FROM "BillboardSlot" b LEFT JOIN "Character" c ON c.id = b."ownerId"`, w, order: orderBy({ paidAt: 'b."paidAt"', board: "b.board" }, q.sort, q.dir ?? "desc", "b.id DESC"), p }));
  },
};

export async function gameList(db, view, q = {}) {
  if (!Object.hasOwn(VIEWS, view)) throw new AdminError("Unknown view.", 404);
  return VIEWS[view](db, q);
}

// ---------------------------------------------------------------- actions
const need = (id) => { if (!REQUEST_ID.test(String(id ?? ""))) throw new AdminError("Missing requestId."); return id; };
const lockChar = async (tx, id) => {
  if (!ID.test(String(id ?? ""))) throw new AdminError("Choose a player.");
  await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${id} FOR UPDATE`;
  const c = await tx.character.findUnique({ where: { id }, select: { id: true, name: true, activeCar: true, sleepingBed: true } });
  if (!c) throw new AdminError("No such player.", 404);
  return c;
};

export const ACTIONS = {
  /** Change a faculty's difficulty (0.50 to 2.00, two decimals) or its verified flag. */
  async "faculty.update"(db, adminId, b) {
    need(b.requestId); const why = reasonOf(b.reason), id = int(b.facultyId, { min: 1 });
    if (id == null) throw new AdminError("Choose a faculty.");
    const data = {};
    if (b.difficulty !== undefined) { const d = String(b.difficulty).trim(); if (!/^\d(\.\d{1,2})?$/.test(d) || Number(d) < 0.5 || Number(d) > 2) throw new AdminError("Difficulty must be between 0.50 and 2.00."); data.difficulty = d; }
    if (b.verified !== undefined) data.verified = b.verified === true;
    if (!Object.keys(data).length) throw new AdminError("Nothing to change.");
    return runAdminOp(db, adminId, { action: "GAME:FACULTY", target: `faculty:${id}`, requestId: b.requestId }, async (tx) => {
      const f = await tx.faculty.findUnique({ where: { id } }); if (!f) throw new AdminError("No such faculty.", 404);
      await tx.faculty.update({ where: { id }, data });
      return { target: `faculty:${id}`, detail: { faculty: f.name, reason: why, before: { difficulty: f.difficulty.toString(), verified: f.verified }, after: data } };
    });
  },

  /** Close a business the way its owner could: the capital goes back to the owner through the ledger. */
  async "business.close"(db, adminId, b) {
    need(b.requestId); const why = reasonOf(b.reason), id = bigId(b.id, "Business");
    const week = await currentWeek(db);
    return runAdminOp(db, adminId, { action: "GAME:BUSINESS_CLOSE", target: `business:${id}`, requestId: b.requestId }, async (tx) => {
      const biz = await tx.business.findUnique({ where: { id } }); if (!biz) throw new AdminError("No such business.", 404);
      if (biz.status !== "ACTIVE") throw new AdminError("That business is not active.", 409);
      const owner = await lockChar(tx, biz.characterId);
      const [pool, acc] = await Promise.all([tx.account.findUnique({ where: { systemName: "BUSINESS" } }), tx.account.findUnique({ where: { characterId: owner.id } })]);
      if (biz.capital > 0n) await transferInTx(tx, { fromId: pool.id, toId: acc.id, amount: biz.capital, memo: `Closed ${biz.name}`, key: `admin:bizclose:${id}:${b.requestId}`, week });
      await tx.business.update({ where: { id }, data: { capital: 0n, status: "CLOSED" } });
      await tx.notification.create({ data: { characterId: owner.id, kind: "ADMIN", body: `Your business ${biz.name} was closed by an administrator. Its ${biz.capital > 0n ? "capital was returned to you." : "balance was empty."}` } });
      return { target: `business:${id}`, detail: { business: biz.name, owner: owner.name, returnedKobo: biz.capital.toString(), reason: why } };
    });
  },

  /** End a bond between two players (no stat penalty: this is an administrator's decision, not a breakup). */
  async "bond.end"(db, adminId, b) {
    need(b.requestId); const why = reasonOf(b.reason), id = bigId(b.bondId, "Bond");
    const week = await currentWeek(db);
    return runAdminOp(db, adminId, { action: "GAME:BOND_END", target: `bond:${id}`, requestId: b.requestId }, async (tx) => {
      const bond = await tx.bond.findUnique({ where: { id } }); if (!bond) throw new AdminError("No such relationship.", 404);
      if (bond.kind === "EX") throw new AdminError("That relationship is already over.", 409);
      await tx.bond.update({ where: { id }, data: { kind: "EX", prevKind: bond.kind, endedWeek: week, endedBy: "ADMIN", together: false, cheatedBy: null } });
      await tx.loveRequest.updateMany({ where: { bondId: id, status: "PENDING" }, data: { status: "CANCELLED", answeredAt: new Date() } });
      for (const cid of [bond.lowId, bond.highId]) await tx.notification.create({ data: { characterId: cid, kind: "ADMIN", body: "An administrator ended one of your relationships." } });
      return { target: `bond:${id}`, detail: { was: bond.kind, players: [bond.lowId, bond.highId], reason: why } };
    });
  },

  async "item.grant"(db, adminId, b) {
    need(b.requestId); const why = reasonOf(b.reason), key = str(b.key, 60);
    if (!isItem(key)) throw new AdminError("That is not an item in the game.");
    const qty = int(b.quantity ?? 1, { min: 1, max: 20 }); if (qty == null) throw new AdminError("Quantity must be 1 to 20.");
    return runAdminOp(db, adminId, { action: "GAME:ITEM_GRANT", target: b.characterId, requestId: b.requestId }, async (tx) => {
      const c = await lockChar(tx, b.characterId);
      await tx.roomItem.createMany({ data: Array.from({ length: qty }, () => ({ characterId: c.id, key, paid: 0n })) });
      const owned = await tx.roomItem.count({ where: { characterId: c.id } });
      return { target: c.id, detail: { player: c.name, item: key, quantity: qty, reason: why, nowOwns: owned, aboveNormalLimit: owned > MAX_ITEMS } };
    });
  },
  async "item.remove"(db, adminId, b) {
    need(b.requestId); const why = reasonOf(b.reason), id = bigId(b.id, "Item");
    return runAdminOp(db, adminId, { action: "GAME:ITEM_REMOVE", target: `item:${id}`, requestId: b.requestId }, async (tx) => {
      const it = await tx.roomItem.findUnique({ where: { id } }); if (!it) throw new AdminError("No such item.", 404);
      const c = await lockChar(tx, it.characterId);
      if (c.sleepingBed === String(id)) await tx.character.update({ where: { id: c.id }, data: { sleepingSince: null, sleepingBed: null } });
      await tx.roomItem.delete({ where: { id } });
      return { target: c.id, detail: { player: c.name, item: it.key, reason: why } };
    });
  },
  async "car.grant"(db, adminId, b) {
    need(b.requestId); const why = reasonOf(b.reason), car = carById(str(b.modelId, 60));
    if (!car) throw new AdminError("That is not a car in the game.");
    return runAdminOp(db, adminId, { action: "GAME:CAR_GRANT", target: b.characterId, requestId: b.requestId }, async (tx) => {
      const c = await lockChar(tx, b.characterId);
      if (await tx.ownedCar.findUnique({ where: { characterId_modelId: { characterId: c.id, modelId: car.id } } })) throw new AdminError(`${c.name} already owns a ${car.name}.`, 409);
      const paint = car.fixedPaint ?? (CAR_PAINTS.some((x) => x.id === b.color) ? b.color : CAR_PAINTS[0].id);
      await tx.ownedCar.create({ data: { characterId: c.id, modelId: car.id, color: paint, pricePaid: 0n } });
      return { target: c.id, detail: { player: c.name, car: car.name, reason: why } };
    });
  },
  async "car.remove"(db, adminId, b) {
    need(b.requestId); const why = reasonOf(b.reason), id = bigId(b.id, "Car");
    return runAdminOp(db, adminId, { action: "GAME:CAR_REMOVE", target: `car:${id}`, requestId: b.requestId }, async (tx) => {
      const o = await tx.ownedCar.findUnique({ where: { id } }); if (!o) throw new AdminError("No such car.", 404);
      const c = await lockChar(tx, o.characterId);
      if (c.activeCar === o.modelId) await tx.character.update({ where: { id: c.id }, data: { activeCar: "", activeCarColor: "" } });
      await tx.ownedCar.delete({ where: { id } });
      return { target: c.id, detail: { player: c.name, car: o.modelId, reason: why } };
    });
  },

  /** Void a running match (both wagers go back through the ledger) or cancel an invitation. */
  async "match.void"(db, adminId, b) {
    need(b.requestId); const why = reasonOf(b.reason), id = bigId(b.matchId, "Match");
    return runAdminOp(db, adminId, { action: "GAME:MATCH_VOID", target: `match:${id}`, requestId: b.requestId }, async (tx) => {
      const m = await tx.gameMatch.findUnique({ where: { id } }); if (!m) throw new AdminError("No such match.", 404);
      if (m.status === "ACTIVE") await voidMatchInTx(tx, m, "An administrator cancelled the match. Every wager was returned.");
      else if (m.status === "INVITED") await tx.gameMatch.update({ where: { id }, data: { status: "CANCELLED", result: "CANCELLED", reason: "Cancelled by an administrator.", finishedAt: new Date() } });
      else throw new AdminError("That match is already over.", 409);
      return { target: `match:${id}`, detail: { game: m.game, was: m.status, stakeKobo: m.stakeKobo.toString(), reason: why } };
    });
  },

  /** Switch a poster off (or back on) without refunding or deleting it. */
  async "billboard.hide"(db, adminId, b) {
    need(b.requestId); const why = reasonOf(b.reason), id = int(b.id, { min: 1 }); if (id == null) throw new AdminError("Choose a poster.");
    const hidden = b.hidden !== false;
    return runAdminOp(db, adminId, { action: hidden ? "GAME:BILLBOARD_HIDE" : "GAME:BILLBOARD_SHOW", target: `billboard:${id}`, requestId: b.requestId }, async (tx) => {
      const s = await tx.billboardSlot.findUnique({ where: { id }, select: { id: true, board: true, slot: true, hidden: true, caption: true } }); if (!s) throw new AdminError("No such poster.", 404);
      await tx.billboardSlot.update({ where: { id }, data: { hidden } });
      return { target: `billboard:${id}`, detail: { board: s.board, slot: s.slot, caption: s.caption, hidden, reason: why } };
    });
  },
};

export async function gameAction(db, adminId, action, body) {
  if (!Object.hasOwn(ACTIONS, action)) throw new AdminError("Unknown action.", 404);
  return ACTIONS[action](db, adminId, body ?? {});
}

// ---------------------------------------------------------------- rules (read-only)
/**
 * The rules and prices the game runs on. These live in code (the files named in each section), because the client and the server must agree on them and
 * they are compiled into both; there is no settings table to edit them from. This is therefore a faithful, read-only view of the live values. The settings that
 * ARE stored in the database and tunable live are faculty difficulty (Academics) and the election calendar (SUG elections).
 */
export function gameRules() {
  const s = (title, file, data, note) => ({ title, file, data, note });
  return jsonSafe({ sections: [
    s("Starting allowance by class", "lib/rules.js", STARTING_ALLOWANCE, "Kobo per week."),
    s("Academic calendar", "lib/rules.js", { sessionWeeks: SESSION_WEEKS, restartLevelAfterExpulsion: RESTART_LEVEL, suspensionHours: SUSPENSION_MS / 3_600_000, expulsionHours: EXPULSION_MS / 3_600_000 }),
    s("Peer-to-peer transfers", "lib/rules.js", P2P),
    s("Jobs", "lib/jobs.js", { maxShiftsPerWeek: MAX_SHIFTS_PER_WEEK, shiftsPerLevel: SHIFTS_PER_LEVEL, maxJobLevel: MAX_JOB_LEVEL, shiftTypes: SHIFT_TYPES, jobs: JOBS }, "Pay is in naira per shift [min, max]."),
    s("Businesses", "lib/business.js", { maxEmployees: MAX_EMPLOYEES, maxLevel: BUSINESS_MAX_LEVEL, types: BUSINESS_TYPES }),
    s("Hustles", "lib/engine.js", HUSTLE),
    s("Transport fares (naira) and driver plans", "lib/travel.js", { fares: FARE_NAIRA, driverPlans: DRIVER_PLANS }),
    s("Cars on sale", "lib/cars.js", CARS.map((c) => ({ id: c.id, name: c.name, priceNaira: c.priceNaira ?? null }))),
    s("Room items", "lib/furniture.js", { maxItems: MAX_ITEMS, sellPercent: SELL_PERCENT, items: Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, { name: v.name, priceNaira: v.price }])) }),
    s("Nightclubs", "lib/clubs.js", { hours: HOURS_LABEL, minSpendNaira: MIN_SPEND, maxSpendNaira: MAX_SPEND, clubs: Object.fromEntries(Object.entries(CLUBS).map(([k, v]) => [k, v.name])), drinks: DRINKS, packages: PACKAGES, buyoutTiers: BUYOUT_TIERS }),
    s("Betting limits (naira)", "lib/bet/*.js", { sports: { min: MIN_STAKE, max: MAX_STAKE, maxLegs: MAX_LEGS }, aviatorMax: AVIATOR_MAX, rouletteMax: ROULETTE_MAX }),
    s("Multiplayer games", "lib/games/index.js", GAME_LIST),
  ] });
}
