// lib/buildingPanel.js
// The Building Activities Panel's logic, as pure functions (no React, no 3D library, no database) so the screen and the Node tests share it.
//
// Nothing is invented here. The cards are DERIVED from three things that already exist:
//   1. featuresAt()   (lib/features.js)  what the building offers: name, icon, price, what it does, how risky it is. A new activity added to
//                                        lib/activities.js shows up here with no edit to this file.
//   2. the rings      (lib3d/interiors/activityHubs.js)  where each activity really stands in the room. An activity with no ring cannot be
//                                        performed, so it never gets a card.
//   3. the server's own list for this player (/api/activity -> hubs)  what is available to them right now (cooldowns, energy, money, custody).
//                                        Until it has answered no card is shown at all.
// The panel only chooses and walks. The server still checks the position, the cost and the limits, and decides every reward.
import { featuresAt, blockedFor } from "./features.js";
import { HUSTLE } from "./engine.js";

export const WALK_SPEED = 1.9; // metres per second: what the automatic walk in lib3d/interiors/scene.js uses
export const NEAR_METRES = 1.7; // inside this the scene's own "use" prompt appears, so no walking is needed

const naira = (n) => "₦" + Number(n).toLocaleString("en-NG");

/** Whole seconds to walk `metres`. */
export const walkSeconds = (metres, speed = WALK_SPEED) => (metres <= NEAR_METRES ? 0 : Math.max(1, Math.ceil(metres / speed)));
/** "Right here", "12s walk", "1m 05s walk". */
export function walkLabel(sec) {
  if (sec == null) return "";
  if (sec <= 0) return "Right here";
  if (sec < 60) return `${sec}s walk`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s walk`;
}
/** "Ready in 4m". Cooldown time left, from the server's `until` (ms). */
export function waitLabel(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${String(Math.ceil((s % 3600) / 60)).padStart(2, "0")}m`;
}

/**
 * What a risky activity can take from the player, read from the real rules (lib/engine.js HUSTLE). Null for a safe one.
 * An activity is risky only when the game can really take something from you for doing it (the same test as riskOf in lib/features.js).
 */
export function riskInfo(card) {
  if (card.risk !== "risky") return null;
  if (card.kind === "hustle_risky") {
    const r = HUSTLE.risky;
    return {
      short: "Can end in jail",
      lines: [
        `You either earn ${naira(r.min)} to ${naira(r.max)}, or N-QRS catches you.`,
        `If caught: cash is seized and you serve ${r.jailMin} to ${r.jailMax} minutes in Floor O (N-QRS Custody).`,
        "You can only try once a day.",
      ],
      confirm: { title: `${card.label}: VERY RISKY`, message: `You either make ${naira(r.min)} to ${naira(r.max)}, or N-QRS catches you and you serve ${r.jailMin} to ${r.jailMax} minutes inside Floor O (N-QRS Custody). You can only try once a day.`, confirmLabel: "Walk there and risk it" },
    };
  }
  // any other activity the registry marks `risky` (def.risky): say what the registry says it costs
  return {
    short: "Can cost you",
    lines: card.costs.length ? card.costs : ["The game can take something from you for doing this."],
    confirm: { title: `${card.label}: RISKY`, message: (card.costs.length ? card.costs.join(" ") : "The game can take something from you for doing this.") + " Do you want to go?", confirmLabel: "Walk there and risk it" },
  };
}

/** A note on an optional risky choice INSIDE a safe activity (the exam has a "try to cheat" option). It never makes the activity RISKY. */
export const optionNote = (card) => (card.kind === "exam" ? "You can sit it honestly. Cheating is a separate, risky choice you are asked about at the desk." : null);

// ---- categories (the chips) -------------------------------------------------------------------------------------------------------------
export const CATEGORY_LABEL = { rest: "Rest", food: "Eat & shop", learn: "Learn", health: "Health", money: "Money", social: "Social", other: "Other" };
const CATEGORY_ORDER = ["rest", "food", "learn", "health", "money", "social", "other"];
/** Which chip an activity sits under (from what it really does). */
export function categoryOf(a) {
  const k = a.kind, d = a.def?.d ?? {};
  if (k === "hustle_safe" || k === "hustle_risky" || a.icon === "bank" || a.icon === "hustle" || a.icon === "dice") return "money";
  if (k === "course_attend" || k === "course_study" || k === "course_test" || k === "exam" || d.academics > 0 || a.icon === "study" || a.icon === "courses") return "learn";
  if (a.icon === "health") return "health";
  if (a.icon === "moon" || a.icon === "sofa" || a.def?.full) return "rest";
  if (a.icon === "kitchen" || a.icon === "bag" || a.icon === "phone") return "food";
  if (a.icon === "talk" || d.popularity > 0) return "social";
  return "other";
}

/**
 * The cards for a place.
 *   placeId, kind   the place (as passed to featuresAt)
 *   rings           the activity rings of this interior: { id, act, label, x, z, floor, room }
 *   hubs            the server's list for this player ({ id, blocked, until, ... }) or null while it has not answered
 *   character, jailed, balanceKobo   what the screen already knows (used only to lock plainly impossible things)
 *   now             Date.now()
 * Returns null while loading, otherwise the cards: available first, then the ones that cannot be started right now (with the reason).
 */
export function buildCards({ placeId, kind = "", rings = [], hubs = null, character = null, jailed = false, balanceKobo = null, now = Date.now() }) {
  if (!hubs) return null;
  const byId = new Map(hubs.map((h) => [h.id, h]));
  const cards = [];
  for (const a of featuresAt(placeId, kind).activities) {
    const mine = rings.filter((r) => r.act === a.act && r.label === a.label && byId.has(r.id));
    if (!mine.length) continue; // no ring in this room, or the server does not offer it to this player: it cannot be done, so it is not shown
    const states = mine.map((r) => ({ ring: r, hub: byId.get(r.id) }));
    const free = states.filter((s) => !s.hub.blocked);
    const local = blockedFor(a, character, { placeId, jailed, balanceKobo });
    const hard = !!jailed && !a.def.jailOk;
    const blocked = free.length === 0 ? states[0].hub.blocked : local;
    const until = free.length === 0 ? Math.min(...states.map((s) => s.hub.until || Infinity)) : 0;
    const card = {
      key: a.key, act: a.act, label: a.label, icon: a.icon ?? "sparkle", kind: a.kind, risk: a.risk, def: a.def, summary: a.summary, explain: a.explain,
      gives: a.gives, certainty: a.certainty, costs: a.costs, requires: a.requires, limits: a.limits, seconds: a.seconds, cost: a.cost,
      price: a.cost ? naira(a.cost) : null,
      rings: (free.length ? free : states).map((s) => s.ring),
      blocked: blocked ?? null, until: Number.isFinite(until) && until > now ? until : 0, hard,
    };
    card.category = categoryOf(card);
    card.risky = riskInfo(card);
    card.note = optionNote(card);
    cards.push(card);
  }
  // available first (keeping the registry's order inside each group)
  return [...cards.filter((c) => !c.blocked), ...cards.filter((c) => c.blocked)];
}

/** The chips that apply to these cards (none when there is only one kind of activity, because a filter would do nothing). */
export function chipsFor(cards) {
  if (!cards?.length) return [];
  const have = new Set(cards.map((c) => c.category)), list = CATEGORY_ORDER.filter((c) => have.has(c));
  return list.length < 2 ? [] : list.map((id) => ({ id, label: CATEGORY_LABEL[id], n: cards.filter((c) => c.category === id).length }));
}

/**
 * Which ring to walk to: the one with the shortest REAL route. `routeOf(ring)` returns { length } or null (no route).
 * Returns { ring, metres, seconds } or null when none of them can be reached.
 */
export function nearestRing(rings, routeOf, standAt = null) {
  let best = null;
  for (const ring of rings) {
    const r = routeOf(ring);
    if (!r) continue;
    const metres = standAt && Math.hypot(standAt.x - ring.x, standAt.z - ring.z) <= NEAR_METRES && (standAt.floor ?? 0) === (ring.floor ?? 0) ? 0 : r.length;
    if (!best || metres < best.metres) best = { ring, metres, seconds: walkSeconds(metres, r.speed ?? WALK_SPEED) };
  }
  return best;
}
