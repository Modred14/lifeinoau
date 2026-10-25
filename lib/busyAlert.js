// lib/busyAlert.js
// The "a lot of people are at SUB right now" notice: what it says, which busy place to mention and when to stay quiet. Pure (the storage is passed in),
// so the rules can be tested without a browser. components/BusyAlerts.js runs it; the server decides which places are busy (lib/busyPlaces.js).
//
// What a busy place is, and everything about who is there, stays on the server: the answer is a list of places, so this can only ever say THAT a place is busy.
// It has no number to show and no player to name.
export const BUSY_ALERT = Object.freeze({
  delayMs: 2000,              // after the game opens: lets the screen and the player's session settle before anything pops up
  recheckMs: 5 * 60_000,      // while the game stays open and visible, look again this often (the server shares one answer between everyone for 15 s)
  cooldownMs: 15 * 60_000,    // no second notice sooner than this after the last one
  repeatMs: 30 * 60_000,      // the same place is not mentioned again within this long (it is not news)
  maxPerSession: 4,           // and never more than this many in one visit
  durationMs: 9000,           // long enough to read it and tap it
});
export const BUSY_STORAGE_KEY = "oau:busy-alerts";

/** One of three ways to say it, always the same one for the same place so it reads the same if it comes up twice. No head count, ever. */
export function busyMessage(place) {
  const name = String(place?.name ?? "").trim();
  if (!name) return "";
  const v = [...String(place.id ?? name)].reduce((t, ch) => t + ch.charCodeAt(0), 0) % 3;
  return [`A lot of people are at ${name} right now.`, `A lot of people are hanging out at ${name}.`, `There’s a lot of activity at ${name} right now.`][v];
}

export const emptyHistory = (cid = null) => ({ cid, count: 0, lastAt: 0, shown: {} });

/** The remembered notices for this visit, or a clean slate when there are none, they are damaged, or they belong to another player on this device. */
export function readHistory(storage, cid) {
  try {
    const h = JSON.parse(storage?.getItem(BUSY_STORAGE_KEY) ?? "null");
    if (h && h.cid === cid && Number.isFinite(h.count) && Number.isFinite(h.lastAt) && h.shown && typeof h.shown === "object") return h;
  } catch { /* unreadable: start clean */ }
  return emptyHistory(cid);
}
export function writeHistory(storage, h) { try { storage?.setItem(BUSY_STORAGE_KEY, JSON.stringify(h)); } catch { /* private mode / full: the in-memory copy still holds for this page */ } }

/** The place to mention now, or null to say nothing. `places` is the server's answer: [{ id, name }], busiest first. */
export function chooseAlert(places, history, now = Date.now(), cfg = BUSY_ALERT) {
  const list = Array.isArray(places) ? places.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim()) : [];
  if (!list.length) return null;                                               // nothing is busy (or the server could not say): say nothing
  if (history.count >= cfg.maxPerSession) return null;
  if (history.count > 0 && now - history.lastAt < cfg.cooldownMs) return null; // only the first notice of a visit is exempt from the pause
  const fresh = list.filter((p) => !(history.shown[p.id] && now - history.shown[p.id] < cfg.repeatMs));
  if (!fresh.length) return null;
  // rotate: a place never mentioned first, otherwise the one mentioned longest ago; the busiest wins a tie (the list is busiest first)
  return fresh.map((p, i) => ({ p, i, at: history.shown[p.id] ?? 0 })).sort((a, b) => a.at - b.at || a.i - b.i)[0].p;
}

export const recordAlert = (history, id, now = Date.now()) => ({ ...history, count: history.count + 1, lastAt: now, shown: { ...history.shown, [id]: now } });
