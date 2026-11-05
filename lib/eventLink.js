// lib/eventLink.js
// Shareable links to one event in the Parties app:  https://lifeinoau.com/home?event=welcome-back-party
// The event's "slug" is made once when the event is added and never changes (renaming the event keeps old links working).
// Pure helpers plus a little browser storage, so the link survives the landing page, the login form and a refresh.

export const EVENT_PARAM = "event";
const KEY = "oau.event"; // the event a visitor was sent to, kept until the phone has opened on it
const KEEP_MS = 30 * 60_000; // a link nobody used for half an hour is forgotten, so it can never pop up much later by surprise
const FOCUS_MS = 2 * 60_000; // the phone has this long to show the event after being asked to
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;

/** "Welcome Back Party!" -> "welcome-back-party". Always returns something usable. */
export function slugify(name) {
  const s = String(name ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || "event";
}

/** A slug from outside (the address bar, storage) or null. Only letters, digits and single dashes pass. */
export function cleanSlug(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s.length > 0 && s.length <= SLUG_MAX && SLUG_RE.test(s) ? s : null;
}

/** The link to share. `base` is the site address (no trailing slash needed). */
export const eventUrl = (slug, base) => `${String(base ?? "").replace(/\/+$/, "")}/home?${EVENT_PARAM}=${encodeURIComponent(slug)}`;
/** Where to send a signed-in player: the game, with the event when there is one. */
export const homeUrl = (slug) => (cleanSlug(slug) ? `/home?${EVENT_PARAM}=${cleanSlug(slug)}` : "/home");
/** Where to send a visitor who is not signed in: the landing page, which opens the log in form. */
export const landingUrl = (slug) => (cleanSlug(slug) ? `/?${EVENT_PARAM}=${cleanSlug(slug)}` : "/");
export const slugFromSearch = (search) => { try { return cleanSlug(new URLSearchParams(search).get(EVENT_PARAM)); } catch { return null; } };

const store = () => { try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; } };

export function rememberEvent(slug, now = Date.now(), s = store()) {
  const v = cleanSlug(slug);
  if (!v || !s) return;
  try { s.setItem(KEY, JSON.stringify({ slug: v, at: now })); } catch { /* storage full or blocked: the address bar still carries it */ }
}
export function forgetEvent(s = store()) { try { s?.removeItem(KEY); } catch { /* ignore */ } }
function remembered(now, s) {
  try {
    const r = JSON.parse(s?.getItem(KEY) ?? "null");
    if (r && typeof r.at === "number" && now - r.at <= KEEP_MS) return cleanSlug(r.slug);
  } catch { /* unreadable: treat as nothing remembered */ }
  return null;
}

/** The event this visitor is heading to: the address bar first, then what was remembered. Leaves it remembered. */
export function pendingEvent(now = Date.now(), search = typeof window !== "undefined" ? window.location.search : "", s = store()) {
  const fromUrl = slugFromSearch(search);
  if (fromUrl) { rememberEvent(fromUrl, now, s); return fromUrl; }
  return remembered(now, s);
}
/** Same, but uses it up: asking twice never gives the same event twice, so the phone cannot be opened twice for one link. */
export function takeEvent(now = Date.now(), search = typeof window !== "undefined" ? window.location.search : "", s = store()) {
  const v = pendingEvent(now, search, s);
  forgetEvent(s);
  return v;
}

// The Parties app picks this up when it has loaded its list (kept in memory, so closing and reopening the app never repeats it).
let focus = null;
export function requestFocus(slug, now = Date.now()) { const v = cleanSlug(slug); focus = v ? { slug: v, at: now } : null; }
export function takeFocus(now = Date.now()) {
  const f = focus; focus = null;
  return f && now - f.at <= FOCUS_MS ? f.slug : null;
}
