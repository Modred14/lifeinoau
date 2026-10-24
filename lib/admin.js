// lib/admin.js
// Authorization and the report queue. Everything else an administrator can do lives in lib/admin*.js (money in adminEconomy, accounts in adminModeration, ...).
// There is deliberately no money function here any more: the old one carried a fixed cap. All balance changes go through moneyOp() in adminEconomy.js.
import { suspensionFields } from "./discipline.js";
import { cleanText } from "./rules.js";
import { naira, parseMoney, pairOf } from "./chatShared.js";
import { AdminError } from "./adminCore.js";

export { AdminError };
/** Non-admins get a 404, so the panel's existence is not revealed. Roles are set only from the server (scripts/make-admin.js). */
export async function requireAdmin(db, userId) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!u || u.role !== "ADMIN") throw new AdminError("Not found.", 404);
  return u;
}
const audit = (db, actorId, action, target, detail) => db.auditLog.create({ data: { actorId, action, target: target ?? null, detail: detail ?? null } });
export async function listReports(db, status = "OPEN") {
  const rows = await db.report.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: 50 });
  const ids = [...new Set(rows.flatMap((r) => [r.reporterId, r.targetId]))];
  const names = new Map((await db.character.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return { reports: rows.map((r) => ({ id: r.id.toString(), reporter: names.get(r.reporterId), target: names.get(r.targetId), reason: r.reason, at: r.createdAt })) };
}

export async function resolveReport(db, adminId, { id, action, note }) {
  if (!["dismiss", "actioned", "suspend"].includes(action)) throw new AdminError("Unknown action.");
  const text = cleanText(note, 300); if (text.length < 5) throw new AdminError("Add a short note explaining the decision.");
  return db.$transaction(async (tx) => {
    const r = await tx.report.findUnique({ where: { id: BigInt(id) } });
    if (!r || r.status !== "OPEN") throw new AdminError("Report not found or already handled.", 404);
    if (action === "suspend") { // a 2 hour suspension from now (a suspension already running is not extended)
      const t = await tx.character.findUnique({ where: { id: r.targetId }, select: { suspendedUntil: true } });
      await tx.character.update({ where: { id: r.targetId }, data: suspensionFields(Date.now(), t) });
    }
    await tx.report.update({ where: { id: r.id }, data: { status: action === "dismiss" ? "DISMISSED" : "ACTIONED" } });
    await audit(tx, adminId, "RESOLVE_REPORT:" + action, r.targetId, { reportId: id, note: text });
    return { ok: true };
  });
}

/** Admins can read messages only through a report, only the last 20 between the two parties, and every read is logged.
 *  A report keeps its own copy of those 20 messages (made when the report was sent), so pruning or blocking cannot erase the evidence.
 *  Reports made before that copy existed read what is still stored. */
export async function reportMessages(db, adminId, id) {
  const r = await db.report.findUnique({ where: { id: BigInt(id) } });
  if (!r) throw new AdminError("Report not found.", 404);
  const show = (m) => ({ fromReporter: m.fromReporter, body: m.kind === 1 ? `Sent ${naira(parseMoney(m.body).naira)}` : m.body, at: m.at });
  let msgs;
  if (Array.isArray(r.evidence)) msgs = r.evidence;
  else {
    const [aId, bId] = pairOf(r.reporterId, r.targetId), chat = await db.chat.findUnique({ where: { aId_bId: { aId, bId } }, select: { id: true } });
    const rows = chat ? await db.message.findMany({ where: { chatId: chat.id }, orderBy: { id: "desc" }, take: 20 }) : [];
    msgs = rows.reverse().map((m) => ({ fromReporter: m.fromA === (r.reporterId === aId), body: m.body, kind: m.kind, at: m.createdAt }));
  }
  await audit(db, adminId, "VIEW_REPORT_MESSAGES", r.targetId, { reportId: id, count: msgs.length });
  return { messages: msgs.map(show) };
}
