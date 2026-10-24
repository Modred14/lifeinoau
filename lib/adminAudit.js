// lib/adminAudit.js
// The audit log, searchable. Every administrator operation writes one row (who, what, which target, the details, OK or FAILED, and why it failed).
// Reading the log is itself not logged (it would drown the log in its own reads), but exporting it is.
import { AdminError, csv, jsonSafe, page, paged, str, oneOf, dateOf, writeAudit } from "./adminCore.js";
import { where, orderBy, like } from "./adminSql.js";

const FROM = `FROM "AuditLog" a
  LEFT JOIN "User" au ON au.id = a."actorId" LEFT JOIN "Character" ac ON ac."userId" = au.id
  LEFT JOIN "Character" tc ON tc.id = a.target LEFT JOIN "Character" tu ON tu."userId" = a.target`;

function filters(q) {
  const w = where();
  const actor = str(q.actor, 60);
  if (actor) w.add(`(a."actorId" = ? OR ac.name ILIKE ? ESCAPE '\\' OR au.email ILIKE ? ESCAPE '\\')`, actor, like(actor), like(actor));
  const action = str(q.action, 60);
  if (action) w.add(`a.action ILIKE ? ESCAPE '\\'`, like(action).replace(/^%|%$/g, "") + "%");
  const target = str(q.target, 60);
  if (target) w.add(`(a.target = ? OR tc.name ILIKE ? ESCAPE '\\' OR tu.name ILIKE ? ESCAPE '\\')`, target, like(target), like(target));
  const status = oneOf(q.status, ["OK", "FAILED"]);
  if (status) w.add(`a.status = ?`, status);
  const from = dateOf(q.from), to = dateOf(q.to);
  if (from) w.add(`a."createdAt" >= ?`, from);
  if (to) w.add(`a."createdAt" < ?`, new Date(+to + 86_400_000));
  const text = str(q.q, 80);
  if (text) w.add(`(a.detail::text ILIKE ? ESCAPE '\\' OR a.error ILIKE ? ESCAPE '\\' OR a.action ILIKE ? ESCAPE '\\')`, like(text), like(text), like(text));
  return w;
}
const SORTS = { createdAt: 'a."createdAt"', action: "a.action" };
const SELECT = `a.id, a."createdAt", a.action, a.status, a.error, a.detail, a."requestId", a."actorId", COALESCE(ac.name, au.email, a."actorId") AS actor, a.target, COALESCE(tc.name, tu.name) AS "targetName"`;
const shape = (r) => ({ id: String(r.id), at: r.createdAt, action: r.action, status: r.status, error: r.error, detail: r.detail, requestId: r.requestId, actorId: r.actorId, actor: r.actor, target: r.target, targetName: r.targetName });

export async function auditLog(db, q = {}) {
  const p = page(q), w = filters(q), order = orderBy(SORTS, q.sort, q.dir ?? "desc", "a.id DESC");
  const [rows, [n], [s]] = await Promise.all([
    db.$queryRawUnsafe(`SELECT ${SELECT} ${FROM} ${w.clause()} ${order} LIMIT ${p.pageSize} OFFSET ${p.offset}`, ...w.values),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n ${FROM} ${w.clause()}`, ...w.values),
    db.$queryRawUnsafe(`SELECT COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed, COUNT(*)::int AS total FROM "AuditLog"`),
  ]);
  return jsonSafe({ ...paged(rows.map(shape), n.n, p), failedTotal: s.failed, allTime: s.total });
}

/** The action names that exist, for the filter dropdown. */
export async function auditActions(db) {
  const rows = await db.$queryRawUnsafe(`SELECT action, COUNT(*)::int AS n FROM "AuditLog" GROUP BY 1 ORDER BY 1`);
  return jsonSafe({ actions: rows });
}

export async function auditExport(db, adminId, q = {}) {
  const w = filters(q);
  const rows = await db.$queryRawUnsafe(`SELECT ${SELECT} ${FROM} ${w.clause()} ORDER BY a.id DESC LIMIT 100000`, ...w.values);
  await writeAudit(db, adminId, "EXPORT_AUDIT", null, { rows: rows.length, filters: Object.fromEntries(Object.entries(q).map(([k, v]) => [k, str(v, 60)])) });
  return csv(["Id", "Time", "Administrator", "Action", "Status", "Target", "Target name", "Request id", "Error", "Details"],
    rows.map((r) => [String(r.id), r.createdAt, r.actor, r.action, r.status, r.target, r.targetName, r.requestId, r.error, r.detail ? JSON.stringify(r.detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : ""]));
}

/** One entry in full, with the neighbouring entries for the same target (to see what led up to it). */
export async function auditEntry(db, id) {
  if (!/^\d{1,18}$/.test(String(id ?? ""))) throw new AdminError("Not a valid log id.");
  const [row] = await db.$queryRawUnsafe(`SELECT ${SELECT} ${FROM} WHERE a.id = $1::bigint`, id);
  if (!row) throw new AdminError("No such log entry.", 404);
  const around = row.target ? await db.$queryRawUnsafe(`SELECT ${SELECT} ${FROM} WHERE a.target = $1 ORDER BY a.id DESC LIMIT 15`, row.target) : [];
  return jsonSafe({ entry: shape(row), around: around.map(shape) });
}
