// lib/adminPlayers.js
// The all-time player directory, one player's full file, and the CSV export.
//
// WHAT "EVERY ACCOUNT" MEANS HERE. Every account is a row in the User table, from the first sign-up onwards, and the directory lists all of them: players
// with a character, accounts that signed up but never made one, suspended accounts and archived (deleted) ones. An account removed from the database
// by hand before this dashboard existed left no row behind, so it cannot be listed, and none are invented. Per-account login and activity tracking only
// started with this feature (User.lastLoginAt / lastActiveAt); for the time before, "last activity" is the newest of the older signals the game kept
// (the Presence table, map and building heartbeats, the action log). `trackingSince` below says when the new tracking began.
import { AdminError, csv, jsonSafe, page, paged, str, int, oneOf, dateOf, publicId, writeAudit } from "./adminCore.js";
import { where, orderBy, like, NOW } from "./adminSql.js";
import { liveSockets, presenceOf, conditionOf, effectiveStatus, RECENT_MS } from "./adminPresence.js";
import { placeName } from "./adminPlaces.js";

const ID = /^[A-Za-z0-9_-]{5,40}$/;
export const EARLY_COUNT = 100;
export const SEGMENTS = {
  early: `the first ${EARLY_COUNT} accounts ever registered`,
  recent: "registered in the last 7 days",
  returning: "registered more than 7 days ago and active in the last 7 days",
  inactive: "no activity for 14 days or more, or never active",
  active: "performed at least one logged game action in the last 30 days",
};
export const STATUSES = ["ACTIVE", "SUSPENDED", "DELETED", "NO_CHARACTER", "EXPELLED", "JAILED", "GRADUATED"];

export const maskEmail = (e) => {
  const [n = "", d = ""] = String(e ?? "").split("@");
  return n ? `${n.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, n.length - 2)))}@${d}` : "";
};

const EFFECTIVE = `CASE WHEN b.status = 'DELETED' THEN 'DELETED' WHEN b.status = 'SUSPENDED' AND (b."statusUntil" IS NULL OR b."statusUntil" > ${NOW}) THEN 'SUSPENDED' ELSE 'ACTIVE' END`;
const LIVE_EVIDENCE = (sockets) => `(b."inAt" > ${NOW} - interval '30 seconds' OR b."tripAt" > ${NOW} - interval '30 seconds' OR b."placeAt" > ${NOW} - interval '90 seconds' OR b."lastActiveAt" > ${NOW} - interval '180 seconds'${sockets ? " OR b.\"characterId\" = ANY($SOCKETS::text[])" : ""})`;

// Everything computed per account, before any filter, so "registration number" stays the true position in the whole history.
const BASE = `
  SELECT u.id AS "userId", u.email, u."createdAt" AS "registeredAt", u.status, u."statusUntil", u."statusReason", u.role, u."lastLoginAt", u."loginCount", u."lastActiveAt",
    c.id AS "characterId", c.name, c.gender::text AS gender, c.class::text AS class, c.level, c.graduated, c.expelled, c."expelledUntil", c."suspendedUntil", c."jailedUntil",
    c."placeId", c."inPlace", c."placeAt", c."inAt", c."tripAt", c."tripMode", c."sleepingSince", c."facultyId", f.name AS faculty, a.balance AS balance,
    GREATEST(u."lastActiveAt", u."lastLoginAt", c."placeAt", c."inAt", c."tripAt", p."lastSeen", al.last) AS "lastActivity", p."lastSeen" AS "seenAt",
    COALESCE(al.n30, 0)::int AS actions30, ROW_NUMBER() OVER (ORDER BY u."createdAt", u.id)::int AS "regNo"
  FROM "User" u LEFT JOIN "Character" c ON c."userId" = u.id LEFT JOIN "Faculty" f ON f.id = c."facultyId" LEFT JOIN "Account" a ON a."characterId" = c.id
  LEFT JOIN "Presence" p ON p."characterId" = c.id
  LEFT JOIN (SELECT "characterId", MAX("createdAt") AS last, COUNT(*) FILTER (WHERE "createdAt" > ${NOW} - interval '30 days') AS n30 FROM "ActionLog" GROUP BY 1) al ON al."characterId" = c.id`;

/** The shared WHERE for the directory and its export. Returns { w, sockets } (sockets: Set | null). */
async function directoryFilter(q) {
  const sockets = q.presence ? await liveSockets() : null;
  const w = where();
  const text = str(q.q, 80);
  if (text) {
    const exact = text, ci = text.toLowerCase(), lk = like(text);
    const parts = [`b.name ILIKE ${w.param(lk)} ESCAPE '\\'`, `b.email ILIKE ${w.param(lk)} ESCAPE '\\'`, `b."userId" = ${w.param(exact)}`, `b."characterId" = ${w.param(exact)}`, `lower(b.name) = ${w.param(ci)}`];
    if (/^[A-Za-z0-9]{6,12}$/.test(text)) parts.push(`right(b."characterId", ${text.length}) = ${w.param(text)}`);
    w.add(`(${parts.join(" OR ")})`);
  }
  const status = oneOf(q.status, STATUSES);
  if (status === "NO_CHARACTER") w.add(`b."characterId" IS NULL`);
  else if (status === "EXPELLED") w.add(`b.expelled = true AND (b."expelledUntil" IS NULL OR b."expelledUntil" > ${NOW})`);
  else if (status === "JAILED") w.add(`b."jailedUntil" > ${NOW}`);
  else if (status === "GRADUATED") w.add(`b.graduated = true`);
  else if (status) w.add(`${EFFECTIVE} = ?`, status);
  const cls = oneOf(q.class, ["NEPO", "MAPO", "LAPO"]);
  if (cls) w.add(`b.class = ?`, cls);
  const lvl = int(q.level, { min: 100, max: 2000 });
  if (lvl != null) w.add(`b.level = ?::int`, lvl);
  const fac = int(q.facultyId, { min: 1 });
  if (fac != null) w.add(`b."facultyId" = ?::int`, fac);
  const rf = dateOf(q.registeredFrom), rt = dateOf(q.registeredTo);
  if (rf) w.add(`b."registeredAt" >= ?`, rf);
  if (rt) w.add(`b."registeredAt" < ?`, new Date(+rt + 86_400_000));
  const af = dateOf(q.activeSince);
  if (af) w.add(`b."lastActivity" >= ?`, af);
  const seg = oneOf(q.segment, Object.keys(SEGMENTS));
  if (seg === "early") w.add(`b."regNo" <= ${EARLY_COUNT}`);
  else if (seg === "recent") w.add(`b."registeredAt" > ${NOW} - interval '7 days'`);
  else if (seg === "returning") w.add(`b."registeredAt" <= ${NOW} - interval '7 days' AND b."lastActivity" > ${NOW} - interval '7 days'`);
  else if (seg === "inactive") w.add(`(b."lastActivity" IS NULL OR b."lastActivity" < ${NOW} - interval '14 days')`);
  else if (seg === "active") w.add(`b.actions30 > 0`);
  const pres = oneOf(q.presence, ["online", "offline"]);
  if (pres) {
    const ev = LIVE_EVIDENCE(!!sockets).replace("$SOCKETS", () => w.param([...(sockets ?? [])]));
    w.add(pres === "online" ? ev : `NOT ${ev}`);
  }
  return { w, sockets };
}

const SORTS = { registeredAt: 'b."registeredAt"', lastActivity: 'b."lastActivity"', name: "lower(b.name)", balance: "b.balance", level: "b.level", actions30: "b.actions30", regNo: 'b."regNo"', logins: 'b."loginCount"' };

const shapeRow = (r, sockets, now) => {
  const pr = r.characterId ? presenceOf({ socket: sockets ? sockets.has(r.characterId) : null, placeAt: r.placeAt, inAt: r.inAt, tripAt: r.tripAt, lastActiveAt: r.lastActiveAt, seenAt: r.seenAt }, now) : null;
  return {
    userId: r.userId, characterId: r.characterId, name: r.name, publicId: r.characterId ? publicId(r.characterId) : null, emailMasked: maskEmail(r.email), regNo: r.regNo,
    registeredAt: r.registeredAt, lastLoginAt: r.lastLoginAt, lastActivity: r.lastActivity, loginCount: r.loginCount, actions30: r.actions30,
    status: effectiveStatus(r.status, r.statusUntil, now), hasCharacter: !!r.characterId, class: r.class, gender: r.gender, level: r.level, faculty: r.faculty, balance: r.balance == null ? null : String(r.balance),
    location: r.characterId ? placeName(+new Date(r.jailedUntil ?? 0) > now ? "floor0" : r.inPlace || r.placeId) : null,
    conditions: r.characterId ? conditionOf(r, now) : [], presence: pr?.state ?? "OFFLINE", isAdmin: r.role === "ADMIN",
  };
};

export async function listPlayers(db, q = {}) {
  const p = page(q), { w, sockets } = await directoryFilter(q), now = Date.now();
  const order = orderBy(SORTS, q.sort, q.dir ?? "desc", 'b."userId"');
  const [rows, [c]] = await Promise.all([
    db.$queryRawUnsafe(`SELECT b.* FROM (${BASE}) b ${w.clause()} ${order} LIMIT ${p.pageSize} OFFSET ${p.offset}`, ...w.values),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM (${BASE}) b ${w.clause()}`, ...w.values),
  ]);
  return { ...paged(rows.map((r) => shapeRow(r, sockets, now)), c.n, p), realtime: !!sockets || !q.presence ? undefined : false };
}

/** Headline numbers and the honest description of what the history covers. */
export async function directorySummary(db) {
  const [s] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS total, COUNT(c.id)::int AS "withCharacter", (COUNT(*) - COUNT(c.id))::int AS "noCharacter",
      COUNT(*) FILTER (WHERE u.status = 'SUSPENDED' AND (u."statusUntil" IS NULL OR u."statusUntil" > ${NOW}))::int AS suspended, COUNT(*) FILTER (WHERE u.status = 'DELETED')::int AS deleted,
      COUNT(*) FILTER (WHERE u."createdAt" > ${NOW} - interval '7 days')::int AS "registered7d", COUNT(*) FILTER (WHERE u."createdAt" > ${NOW} - interval '30 days')::int AS "registered30d",
      MIN(u."createdAt") AS "firstAccountAt", MIN(u."lastLoginAt") AS "trackingSince", COUNT(*) FILTER (WHERE u."lastLoginAt" IS NULL AND u."lastActiveAt" IS NULL)::int AS "untracked"
      FROM "User" u LEFT JOIN "Character" c ON c."userId" = u.id`);
  return {
    ...s, segments: SEGMENTS,
    coverage: "Every account ever created is listed (each is a row in the User table). Accounts erased from the database by hand before this dashboard existed left no record and cannot be shown; none are invented. " +
      "Per-account login and activity tracking began with this feature" + (s.trackingSince ? ` (first tracked login: ${new Date(s.trackingSince).toISOString().slice(0, 10)})` : "") +
      "; before that, 'last activity' is the newest of the game's older signals (presence, map heartbeats, action log), and an account with none shows no activity.",
  };
}

/** CSV of the filtered directory. Emails are left out unless asked for (and the export is audited either way). */
export async function exportPlayers(db, adminId, q = {}) {
  const { w, sockets } = await directoryFilter(q), now = Date.now(), withEmail = q.emails === "1";
  const order = orderBy(SORTS, q.sort, q.dir ?? "desc", 'b."userId"');
  const rows = await db.$queryRawUnsafe(`SELECT b.* FROM (${BASE}) b ${w.clause()} ${order} LIMIT 100000`, ...w.values);
  await writeAudit(db, adminId, "EXPORT_PLAYERS", null, { rows: rows.length, filters: Object.fromEntries(Object.entries(q).filter(([k]) => k !== "emails").map(([k, v]) => [k, str(v, 60)])), includesEmail: withEmail });
  const head = ["Registration no", "Username", "Player id", ...(withEmail ? ["Email"] : []), "Registered", "Last login", "Last activity", "Logins", "Actions (30d)", "Account status", "Presence", "Class", "Level", "Faculty", "Balance (kobo)", "Location"];
  const body = rows.map((r) => { const s = shapeRow(r, sockets, now); return [s.regNo, s.name ?? "(no character)", s.characterId ?? s.userId, ...(withEmail ? [r.email] : []), s.registeredAt, s.lastLoginAt, s.lastActivity, s.loginCount, s.actions30, s.status, s.presence, s.class, s.level, s.faculty, s.balance, s.location]; });
  return csv(head, body);
}

/** Resolve whatever an administrator has: a user id, a character id, a name, or the short public id. */
export async function findAccount(db, ref) {
  const s = str(ref, 60);
  if (!s) throw new AdminError("Enter a player id or name.");
  const rows = await db.$queryRawUnsafe(`SELECT u.id AS "userId", c.id AS "characterId" FROM "User" u LEFT JOIN "Character" c ON c."userId" = u.id
      WHERE u.id = $1 OR c.id = $1 OR lower(c.name) = lower($1) OR ($2::boolean AND right(c.id, length($1)) = $1) LIMIT 3`, s, /^[A-Za-z0-9]{8}$/.test(s));
  if (!rows.length) throw new AdminError("No player matches that.", 404);
  if (rows.length > 1) throw new AdminError("That matches more than one player. Use the full id.", 409);
  return rows[0];
}

const MOD_ACTIONS = /^(MODERATION|ACCOUNT|WARN|GAME_SUSPEND|EXPEL|CUSTODY|RESOLVE_REPORT)/;

/** One player's whole file. Reading it is itself written to the audit log (it shows the full email). */
export async function playerDetail(db, adminId, ref) {
  const { userId, characterId } = await findAccount(db, ref), now = Date.now();
  const [[base]] = await Promise.all([db.$queryRawUnsafe(`SELECT b.*, u2."statusAt", u2."statusBy" FROM (${BASE}) b JOIN "User" u2 ON u2.id = b."userId" WHERE b."userId" = $1`, userId)]);
  const sockets = await liveSockets();
  const out = { account: { userId, email: base.email, role: base.role, registeredAt: base.registeredAt, regNo: base.regNo, lastLoginAt: base.lastLoginAt, lastActivity: base.lastActivity, loginCount: base.loginCount,
    status: effectiveStatus(base.status, base.statusUntil, now), rawStatus: base.status, statusReason: base.statusReason, statusUntil: base.statusUntil, statusAt: base.statusAt, statusBy: base.statusBy } };
  if (!characterId) { await writeAudit(db, adminId, "VIEW_PLAYER", userId, { name: null }); return jsonSafe({ ...out, character: null, presence: { state: "OFFLINE", sources: [] } }); }
  const T = (sql, ...v) => db.$queryRawUnsafe(sql, ...v);
  const [ch, ledger, audits, actions, runs, shifts, hustles, club, bonds, npcRel, biz, hold, cars, room, ach, exams, reports, jail, blocks, forbes] = await Promise.all([
    T(`SELECT c.*, c.class::text AS class, c.gender::text AS gender, f.name AS faculty, a.id AS "accountId", a.balance::text AS balance FROM "Character" c JOIN "Faculty" f ON f.id = c."facultyId" JOIN "Account" a ON a."characterId" = c.id WHERE c.id = $1`, characterId),
    T(`SELECT le.id, le."createdAt", le.memo, le.amount::text AS amount, le."gameWeek", (le."creditAccountId" = a.id) AS incoming FROM "LedgerEntry" le JOIN "Account" a ON a."characterId" = $1 WHERE le."debitAccountId" = a.id OR le."creditAccountId" = a.id ORDER BY le.id DESC LIMIT 30`, characterId),
    T(`SELECT id, "actorId", action, target, detail, status, error, "createdAt" FROM "AuditLog" WHERE target = $1 OR target = $2 ORDER BY id DESC LIMIT 60`, characterId, userId),
    T(`SELECT action, "gameWeek", "createdAt" FROM "ActionLog" WHERE "characterId" = $1 ORDER BY id DESC LIMIT 25`, characterId),
    T(`SELECT "activityId", "placeId", status, "startedAt", "endsAt" FROM "ActivityRun" WHERE "characterId" = $1 ORDER BY id DESC LIMIT 15`, characterId),
    T(`SELECT id, "jobKey", "shiftKey", status, "payKobo"::text AS pay, "startedAt" FROM "JobShift" WHERE "characterId" = $1 ORDER BY id DESC LIMIT 10`, characterId),
    T(`SELECT id, kind, status, caught, "payKobo"::text AS pay, "startedAt" FROM "HustleRun" WHERE "characterId" = $1 ORDER BY id DESC LIMIT 10`, characterId),
    T(`SELECT "clubId", kind, "itemName", amount::text AS amount, "createdAt" FROM "ClubTransaction" WHERE "characterId" = $1 ORDER BY id DESC LIMIT 10`, characterId),
    T(`SELECT b.id, b.kind, b.affection, b."startedWeek", b."endedWeek", o.name AS partner, o.id AS "partnerId" FROM "Bond" b JOIN "Character" o ON o.id = (CASE WHEN b."lowId" = $1 THEN b."highId" ELSE b."lowId" END) WHERE b."lowId" = $1 OR b."highId" = $1 ORDER BY b.id DESC LIMIT 20`, characterId),
    T(`SELECT id, "npcName", stage, affection, status FROM "Relationship" WHERE "characterId" = $1 ORDER BY id DESC LIMIT 5`, characterId),
    T(`SELECT id, name, type, level, capital::text AS capital, status FROM "Business" WHERE "characterId" = $1 ORDER BY id`, characterId),
    T(`SELECT product, "valueKobo"::text AS value FROM "Holding" WHERE "characterId" = $1 ORDER BY "valueKobo" DESC LIMIT 20`, characterId),
    T(`SELECT "modelId", color, "pricePaid"::text AS paid FROM "OwnedCar" WHERE "characterId" = $1`, characterId),
    T(`SELECT COUNT(*)::int AS items FROM "RoomItem" WHERE "characterId" = $1`, characterId).catch(() => [{ items: null }]),
    T(`SELECT COUNT(*)::int AS n FROM "Achievement" WHERE "characterId" = $1`, characterId),
    T(`SELECT COUNT(*)::int AS n, ROUND(AVG("gradePoint")::numeric, 2)::text AS avg FROM "ExamResult" WHERE "characterId" = $1`, characterId),
    T(`SELECT COUNT(*) FILTER (WHERE "targetId" = $1)::int AS against, COUNT(*) FILTER (WHERE "reporterId" = $1)::int AS filed, COUNT(*) FILTER (WHERE "targetId" = $1 AND status = 'OPEN')::int AS open FROM "Report" WHERE "targetId" = $1 OR "reporterId" = $1`, characterId),
    T(`SELECT id, reason, status, "startedAt", "releaseAt", bill::text AS bill FROM "FloorZero" WHERE "characterId" = $1 ORDER BY id DESC LIMIT 8`, characterId),
    T(`SELECT COUNT(*) FILTER (WHERE "blockerId" = $1)::int AS blocked, COUNT(*) FILTER (WHERE "blockedId" = $1)::int AS "blockedBy" FROM "Block" WHERE "blockerId" = $1 OR "blockedId" = $1`, characterId),
    T(`SELECT x.* FROM (SELECT c.id, (a.balance + COALESCE(sv.balance, 0) + COALESCE(b.cap, 0) + COALESCE(h.inv, 0))::text AS total, COALESCE(sv.balance, 0)::text AS sav, COALESCE(b.cap, 0)::text AS biz, COALESCE(h.inv, 0)::text AS inv, c."hideFromForbes" AS hidden,
        RANK() OVER (PARTITION BY (c."hideFromForbes" OR u.status = 'DELETED') ORDER BY (a.balance + COALESCE(sv.balance, 0) + COALESCE(b.cap, 0) + COALESCE(h.inv, 0)) DESC) AS rank
        FROM "Account" a JOIN "Character" c ON c.id = a."characterId" JOIN "User" u ON u.id = c."userId"
        LEFT JOIN "SavingsAccount" sv ON sv."characterId" = c.id
        LEFT JOIN (SELECT "characterId", SUM(capital) AS cap FROM "Business" WHERE status = 'ACTIVE' GROUP BY 1) b ON b."characterId" = c.id
        LEFT JOIN (SELECT "characterId", SUM("valueKobo") AS inv FROM "Holding" GROUP BY 1) h ON h."characterId" = c.id WHERE a.kind = 'PLAYER') x WHERE x.id = $1`, characterId),
  ]);
  const c = ch[0];
  const pr = presenceOf({ socket: sockets ? sockets.has(characterId) : null, placeAt: c.placeAt, inAt: c.inAt, tripAt: c.tripAt, lastActiveAt: base.lastActiveAt, seenAt: base.seenAt }, now);
  await writeAudit(db, adminId, "VIEW_PLAYER", characterId, { name: c.name });
  const { accountId, ...character } = c;
  return jsonSafe({
    ...out,
    character: { ...character, publicId: publicId(characterId), location: placeName(+new Date(c.jailedUntil ?? 0) > now ? "floor0" : c.inPlace || c.placeId) },
    balance: c.balance, presence: { ...pr, realtime: !!sockets }, conditions: conditionOf(c, now),
    forbes: forbes[0] ? { netWorthKobo: forbes[0].total, savingsKobo: forbes[0].sav, businessKobo: forbes[0].biz, investmentsKobo: forbes[0].inv, excluded: forbes[0].hidden, rank: forbes[0].hidden ? null : Number(forbes[0].rank) } : null,
    ledger: ledger.map((e) => ({ id: String(e.id), at: e.createdAt, memo: e.memo, amountKobo: e.amount, incoming: e.incoming, week: e.gameWeek })),
    history: audits.map((a) => ({ id: String(a.id), at: a.createdAt, actor: a.actorId, action: a.action, status: a.status, detail: a.detail, error: a.error, moderation: MOD_ACTIONS.test(a.action) })),
    activity: { actions, runs, shifts, hustles, club },
    relationships: { bonds, npc: npcRel }, businesses: biz, holdings: hold, cars, roomItems: room[0]?.items ?? null, achievements: ach[0].n, exams: exams[0], reports: reports[0], custody: jail, blocks: blocks[0],
  });
}

export { RECENT_MS };
