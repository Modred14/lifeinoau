// lib/lovePatches.js
// What the Love app shows the moment a button is tapped, before the server has answered. Each function takes the screen's data and returns
// the data as it will look if the server says yes (see lib/optimistic.js: if it says no, the change is taken back). They are pure and
// use the same numbers as the server (lib/relationships.js), so the real answer that follows almost always matches.
import { ACTIVITY, GIFTS, LABEL, COUPLE, INVITES, progress, moodOf, clamp, ringOf, startKind, REQUEST_TEXT } from "./relationships.js";

const WAIT = "Waiting for their answer.";
const DONE = "You already did that this week.";
const tidy = (b) => { const pr = progress(b); return { ...b, progress: pr.items, ready: pr.ready, mood: moodOf(b.affection), label: LABEL[b.kind] }; };
const onBond = (d, id, fn) => ({ ...d, bonds: d.bonds.map((b) => (b.id === id ? tidy(fn(b)) : b)) });
const bondOf = (d, id) => d.bonds.find((b) => b.id === id);
const key = (kind) => (INVITES.includes(kind.toLowerCase()) ? kind.toLowerCase() : kind);

/** Note, food or gift: happens at once. */
export const solo = (id, activity, tier) => (d) => onBond(d, id, (b) => {
  const a = ACTIVITY[activity], aff = activity === "gift" ? (GIFTS[tier]?.[1] ?? 0) : a.aff;
  return { ...b, affection: clamp(b.affection + aff), meals: b.meals + (activity === "food" ? 1 : 0), done: { ...b.done, [activity]: true }, can: { ...b.can, [activity]: DONE } };
});

/** An invite or a status ask has been sent: it shows as waiting. */
export const sent = (id, kind, variant, tmpId) => (d) => {
  const b = bondOf(d, id); if (!b) return d;
  const req = { id: tmpId, bondId: id, kind, variant: variant ?? null, mine: true, from: d.me.name, to: b.name, week: d.week, expiresWeek: d.week + 3, text: REQUEST_TEXT[kind]?.(d.me.name) };
  const next = onBond(d, id, (x) => ({ ...x, pending: [...x.pending, req], can: { ...x.can, [key(kind)]: WAIT } }));
  return { ...next, requests: [req, ...next.requests] };
};

/** You took your own request back. */
export const cancelled = (reqId) => (d) => {
  const r = d.requests.find((x) => x.id === reqId); if (!r) return d;
  const next = { ...d, requests: d.requests.filter((x) => x.id !== reqId) };
  return onBond(next, r.bondId, (b) => ({ ...b, pending: b.pending.filter((x) => x.id !== reqId), can: { ...b.can, [key(r.kind)]: null } }));
};

/** You answered someone else's request. */
export const answered = (reqId, accept) => (d) => {
  const r = d.requests.find((x) => x.id === reqId); if (!r) return d;
  const next = { ...d, requests: d.requests.filter((x) => x.id !== reqId) };
  return onBond(next, r.bondId, (b) => {
    const rest = { ...b, pending: b.pending.filter((x) => x.id !== reqId) };
    if (!accept) return rest;
    const k = r.kind, lower = k.toLowerCase();
    if (INVITES.includes(lower)) {
      const a = ACTIVITY[lower];
      return { ...rest, affection: clamp(b.affection + a.aff), dates: b.dates + (lower === "date" ? 1 : 0), visits: b.visits + (lower === "visit" ? 1 : 0), done: { ...b.done, [lower]: true }, can: { ...b.can, [lower]: DONE } };
    }
    if (k === "BABE" || k === "SNEAKY") return { ...rest, kind: k, weeks: 0, affection: clamp(b.affection + 10) };
    if (k === "PROPOSE") return { ...rest, kind: "ENGAGED", weeks: 0, affection: clamp(b.affection + (ringOf(r.variant)?.aff ?? 20)) };
    if (k === "MOVEIN") return { ...rest, together: true, affection: clamp(b.affection + 15) };
    if (k === "RECONCILE") return { ...rest, kind: b.prevKind === "ENGAGED" ? "BABE" : (b.prevKind ?? "TALKING"), weeks: 0, affection: Math.max(40, Math.floor(b.affection / 2)), endedWeek: null };
    return rest;
  });
};

export const brokeUp = (id) => (d) => {
  const next = onBond(d, id, (b) => ({ ...b, kind: "EX", prevKind: b.kind, together: false, cheat: null, pending: [], endedWeek: d.week, endedByMe: true, affection: 0 }));
  return { ...next, requests: next.requests.filter((r) => r.bondId !== id) };
};
export const forgave = (id) => (d) => onBond(d, id, (b) => ({ ...b, cheat: null, affection: clamp(b.affection + 10) }));
export const apologised = (id) => (d) => onBond(d, id, (b) => ({ ...b, affection: clamp(b.affection + 15), done: { ...b.done, apology: true } }));
export const startedOver = (id) => (d) => onBond(d, id, (b) => ({ ...b, kind: startKind(d.me.gender, b.gender), prevKind: null, affection: 0, weeks: 0, dates: 0, meals: 0, visits: 0, endedWeek: null }));
export const removed = (id) => (d) => ({ ...d, bonds: d.bonds.filter((b) => b.id !== id), requests: d.requests.filter((r) => r.bondId !== id) });

/** Someone you have talked to is now in your Love list. */
export const added = (person) => (d) => {
  const kind = person.kind, tmp = "tmp-" + person.name;
  const can = Object.fromEntries([...Object.keys(ACTIVITY), "BABE", "SNEAKY", "PROPOSE", "MOVEIN", "RECONCILE"].map((k) => {
    const a = ACTIVITY[k];
    const ok = a ? a.kinds.includes(kind) : false;
    return [k, ok ? null : (a ? "Not for you two." : "Do more together first.")];
  }));
  const b = tidy({ id: tmp, name: person.name, gender: person.gender, faculty: person.faculty, level: person.level, kind, prevKind: null, affection: 0, weeks: 0, startedWeek: d.week, together: false,
    dates: 0, meals: 0, visits: 0, done: {}, cheat: null, endedWeek: null, can, pending: [], memories: [{ week: d.week, text: kind === "BESTIE" ? "You became besties." : "You started talking." }] });
  return { ...d, bonds: [...d.bonds, b], discover: d.discover.filter((p) => p.name !== person.name) };
};

export const isCouple = (b) => COUPLE.includes(b.kind);