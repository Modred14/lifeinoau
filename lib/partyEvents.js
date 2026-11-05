// lib/partyEvents.js
// Real parties and events for the Parties app. Administrators add them (lib/adminEvents.js); players only read them here.
// An event has a flyer picture, a name, a host, a price (real naira, kept as kobo), a date and the link where tickets are sold.
import { cleanText } from "./rules.js";
import { slugify, SLUG_MAX } from "./eventLink.js";

export const FLYER_MAX_BYTES = 600_000;
const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
/** An event stays on the list until this long after it starts, so a party that is under way can still be found. */
export const KEEP_AFTER_START_MS = 12 * 3_600_000;

export class EventInputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** "data:image/png;base64,...." -> { bytes, mime }. Checks size and the file's real signature, not just its label. */
export function parseFlyer(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!m) throw new EventInputError("Upload the flyer as a JPG, PNG or WebP picture.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length < 100) throw new EventInputError("That flyer looks empty.");
  if (bytes.length > FLYER_MAX_BYTES) throw new EventInputError("That flyer is too big. Keep it under 600 KB.", 413);
  const sig = (...a) => a.every((v, i) => bytes[i] === v);
  const ok = m[1] === "jpeg" ? sig(0xff, 0xd8, 0xff) : m[1] === "png" ? sig(0x89, 0x50, 0x4e, 0x47) : sig(0x52, 0x49, 0x46, 0x46) && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  if (!ok) throw new EventInputError("That file is not a real " + m[1].toUpperCase() + " picture.");
  return { bytes, mime: MIME[m[1]] };
}

/** The ticket link must be a plain web address. Anything else (javascript:, data:, a bare word) is refused, because players are sent straight to it. */
export function parseTicketUrl(v) {
  const s = String(v ?? "").trim();
  if (!s || s.length > 500) throw new EventInputError("Enter the ticket link (up to 500 characters).");
  let u;
  try { u = new URL(s); } catch { throw new EventInputError("The ticket link must be a full web address, starting with https://"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new EventInputError("The ticket link must start with https:// or http://");
  return u.toString();
}

export const cleanName = (v, what, max) => {
  const t = cleanText(v, max);
  if (t.length < 2) throw new EventInputError(`${what} is required (2 to ${max} characters).`);
  return t;
};

export const flyerUrl = (e) => `/api/parties/flyer?id=${e.id}&v=${e.updatedAt.getTime()}`;

/** A link name nobody else has: "welcome-back-party", then "welcome-back-party-2", -3 ... Made once, when the event is added; renaming the event never changes it. */
export async function uniqueSlug(db, name) {
  const base = slugify(name);
  for (let n = 1; n < 1000; n++) {
    const cand = n === 1 ? base : `${base.slice(0, SLUG_MAX - String(n).length - 1).replace(/-+$/, "")}-${n}`;
    if (!(await db.partyEvent.findUnique({ where: { slug: cand }, select: { id: true } }))) return cand;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export const shapeEvent = (e) => ({ id: e.id, slug: e.slug, name: e.name, host: e.host, priceKobo: e.priceKobo.toString(), date: e.eventDate.toISOString(), ticketUrl: e.ticketUrl, flyer: flyerUrl(e) });

/** Events from now on, soonest first. Several can fall in the same week: nothing limits how many a player may go to. */
export async function listEvents(db, now = new Date()) {
  const rows = await db.partyEvent.findMany({
    where: { eventDate: { gte: new Date(now.getTime() - KEEP_AFTER_START_MS) } },
    orderBy: [{ eventDate: "asc" }, { id: "asc" }],
    select: { id: true, slug: true, name: true, host: true, priceKobo: true, eventDate: true, ticketUrl: true, updatedAt: true },
  });
  return { events: rows.map(shapeEvent) };
}

/** The flyer picture of one event, or null. */
export async function flyerImage(db, id) {
  if (!Number.isInteger(id) || id < 1) return null;
  const e = await db.partyEvent.findUnique({ where: { id }, select: { flyer: true, flyerMime: true } });
  return e ? { bytes: e.flyer, mime: e.flyerMime } : null;
}
