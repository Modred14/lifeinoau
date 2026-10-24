// lib/adminNotify.js
// Announcements and targeted notices. A notice is a Notification row, which the game already shows to a player as a toast the next time their screen
// asks for its state, so this needs no new channel and works the same for everyone. Who receives it is resolved by the same audience rules as a group
// reward (lib/adminAudience.js: accounts in good standing only).
//
// A big audience is written in pieces of CHUNK so no request runs long. Each piece is its own audited transaction keyed `<requestId>:<offset>`, so sending
// the same piece twice (a retry, a double click) writes nothing the second time, and a stopped send can be resumed from `nextOffset`.
import { AdminError, REQUEST_ID, runAdminOp, reasonOf, jsonSafe, page, paged, int } from "./adminCore.js";
import { resolveAudience } from "./adminAudience.js";
import { where, like } from "./adminSql.js";
import { cleanText } from "./rules.js";

export const CHUNK = 500;
export const CONFIRM_ABOVE = 5;

export async function noticePreview(db, { audience }) {
  const { ids, label, missing } = await resolveAudience(db, audience);
  const sample = ids.length ? await db.$queryRawUnsafe(`SELECT name FROM "Character" WHERE id = ANY($1::text[]) ORDER BY name LIMIT 8`, ids.slice(0, 200)) : [];
  return { count: ids.length, label, missing, sample: sample.map((s) => s.name), confirmText: ids.length > CONFIRM_ABOVE ? `SEND ${ids.length}` : null };
}

export async function sendNotice(db, adminId, { audience, message, kind, requestId, confirm, expectedCount, offset = 0 }) {
  if (!REQUEST_ID.test(String(requestId ?? "")) || String(requestId).length > 80) throw new AdminError("Missing requestId.");
  const text = cleanText(message, 280);
  if (text.length < 3) throw new AdminError("Write the message (3 to 280 characters).");
  const nk = kind === "ANNOUNCEMENT" ? "ANNOUNCEMENT" : "ADMIN";
  const { ids, label } = await resolveAudience(db, audience);
  if (!ids.length) throw new AdminError("Nobody matches that audience.");
  if (Number(expectedCount) !== ids.length) throw new AdminError(`The audience changed: it is now ${ids.length}. Preview it again before sending.`, 409);
  if (ids.length > CONFIRM_ABOVE && String(confirm ?? "").trim() !== `SEND ${ids.length}`) throw new AdminError(`Type SEND ${ids.length} to confirm.`);
  const start = int(offset, { min: 0, fallback: 0 }), slice = ids.slice(start, start + CHUNK);
  const r = await runAdminOp(db, adminId, { action: "NOTICE:CHUNK", requestId: `${requestId}:${start}`.slice(0, 128), target: null }, async (tx) => {
    await tx.notification.createMany({ data: slice.map((characterId) => ({ characterId, kind: nk, body: text })) });
    return { detail: { audience: label, from: start, count: slice.length } };
  });
  const next = start + slice.length, finished = next >= ids.length;
  if (finished) {
    await runAdminOp(db, adminId, { action: "NOTICE:SENT", requestId: `${requestId}:done` }, async () => ({ detail: { audience: label, audienceType: audience.type, recipients: ids.length, kind: nk, message: text } }));
  }
  return { ok: true, total: ids.length, processed: next, nextOffset: finished ? null : next, done: finished, repeated: !!r.duplicate };
}

/** Notices sent so far (the NOTICE:SENT audit rows), newest first. */
export async function noticeHistory(db, q = {}) {
  const p = page(q);
  const [rows, [n]] = await Promise.all([
    db.$queryRawUnsafe(`SELECT a.id, a."createdAt", a."actorId", a.detail, COALESCE(c.name, u.email, a."actorId") AS actor FROM "AuditLog" a LEFT JOIN "User" u ON u.id = a."actorId" LEFT JOIN "Character" c ON c."userId" = u.id
      WHERE a.action = 'NOTICE:SENT' AND a.status = 'OK' ORDER BY a.id DESC LIMIT ${p.pageSize} OFFSET ${p.offset}`),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "AuditLog" WHERE action = 'NOTICE:SENT' AND status = 'OK'`),
  ]);
  return jsonSafe(paged(rows.map((r) => ({ id: String(r.id), at: r.createdAt, actor: r.actor, ...r.detail })), n.n, p));
}
