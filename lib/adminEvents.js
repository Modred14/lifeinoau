// lib/adminEvents.js
// Administrator tools for the Parties app's events: list, add, change, remove. Every change is one audited operation (lib/adminCore.js runAdminOp),
// so a repeated request never adds the event twice and the audit log shows who listed or removed which event.
import { AdminError, runAdminOp, parseKobo, dateOf, int, jsonSafe } from "./adminCore.js";
import { EventInputError, parseFlyer, parseTicketUrl, cleanName, flyerUrl } from "./partyEvents.js";

/** Turn the validation errors of lib/partyEvents.js into the console's own error type, so the message reaches the administrator. */
const check = (fn) => { try { return fn(); } catch (e) { if (e instanceof EventInputError) throw new AdminError(e.message, e.status); throw e; } };

function fields(b) {
  const name = check(() => cleanName(b.name, "The event name", 80)), host = check(() => cleanName(b.host, "The host", 80));
  const priceKobo = parseKobo(String(b.price ?? "").trim() || "0",{ allowZero: true, what: "The price" });
  const eventDate = dateOf(b.date);
  if (!eventDate) throw new AdminError("Pick the date and time of the event.");
  const ticketUrl = check(() => parseTicketUrl(b.ticketUrl));
  return { name, host, priceKobo, eventDate, ticketUrl };
}

const row = (e) => ({ id: e.id, name: e.name, host: e.host, priceKobo: e.priceKobo.toString(), date: e.eventDate.toISOString(), ticketUrl: e.ticketUrl, flyer: flyerUrl(e), createdAt: e.createdAt });

/** Every event, past ones too, newest date first, so an administrator can still correct or remove an old listing. */
export async function listAll(db) {
  const rows = await db.partyEvent.findMany({ orderBy: [{ eventDate: "desc" }, { id: "desc" }], select: { id: true, name: true, host: true, priceKobo: true, eventDate: true, ticketUrl: true, createdAt: true, updatedAt: true } });
  return jsonSafe({ rows: rows.map(row), now: new Date().toISOString() });
}

export async function createEvent(db, adminId, b) {
  const f = fields(b), pic = check(() => parseFlyer(b.flyer));
  return runAdminOp(db, adminId, { action: "EVENT:CREATE", requestId: b.requestId }, async (tx) => {
    const e = await tx.partyEvent.create({ data: { ...f, flyer: pic.bytes, flyerMime: pic.mime, createdBy: adminId }, select: { id: true } });
    return { target: String(e.id), result: { id: e.id }, detail: { name: f.name, host: f.host, priceKobo: f.priceKobo.toString(), date: f.eventDate.toISOString(), ticketUrl: f.ticketUrl } };
  });
}

/** Change an event. The flyer is only replaced when a new picture is sent; leaving it out keeps the current one. */
export async function updateEvent(db, adminId, b) {
  const id = int(b.id, { min: 1 });
  if (!id) throw new AdminError("Which event?");
  const f = fields(b), pic = b.flyer ? check(() => parseFlyer(b.flyer)) : null;
  return runAdminOp(db, adminId, { action: "EVENT:UPDATE", requestId: b.requestId, target: String(id) }, async (tx) => {
    if (!(await tx.partyEvent.findUnique({ where: { id }, select: { id: true } }))) throw new AdminError("That event no longer exists.", 404);
    await tx.partyEvent.update({ where: { id }, data: { ...f, ...(pic ? { flyer: pic.bytes, flyerMime: pic.mime } : {}) } });
    return { target: String(id), detail: { name: f.name, host: f.host, priceKobo: f.priceKobo.toString(), date: f.eventDate.toISOString(), ticketUrl: f.ticketUrl, flyerReplaced: !!pic } };
  });
}

export async function deleteEvent(db, adminId, b) {
  const id = int(b.id, { min: 1 });
  if (!id) throw new AdminError("Which event?");
  return runAdminOp(db, adminId, { action: "EVENT:DELETE", requestId: b.requestId, target: String(id) }, async (tx) => {
    const e = await tx.partyEvent.findUnique({ where: { id }, select: { name: true, eventDate: true } });
    if (!e) throw new AdminError("That event no longer exists.", 404);
    await tx.partyEvent.delete({ where: { id } });
    return { target: String(id), detail: { name: e.name, date: e.eventDate.toISOString() } };
  });
}
