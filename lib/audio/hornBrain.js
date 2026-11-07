// lib/audio/hornBrain.js
// When a computer-driven vehicle honks. Pure JS. It looks at what is in the way of each vehicle (the thing the traffic simulation says it is following) and decides,
// like a patient driver: a person standing in the road ahead gets one warning toot as it comes up to them, and more if it is stopped and they do not move; a vehicle that is
// stopped in front for a long time gets an impatient toot; a vehicle waiting its turn at a junction hardly honks at all. Nobody honks every second:
//   - one honk, a double or one long honk, then a quiet spell for that vehicle (at least 9 s, and at most 3 honks at one blockage, then 30 s of silence),
//   - never more than one NPC honk per second anywhere, and none for a vehicle too far away to be heard.
// consider() is cheap: call it for the vehicles near the listener a few times a second.
const PERSON = new Set(["ped", "player"]);

/** What a `lead` from the traffic simulation is in the way: "ped" (a walker), "player" (you on foot), "vehicle", or "other" (your own car). */
export function leadKind(who) {
  if (!who) return null;
  if (who.edge !== undefined && who.speed !== undefined) return "ped";   // a simulated pedestrian
  if (who.kind !== undefined && who.route !== undefined) return "vehicle";
  if ((who.len ?? 9) < 1) return "player";                              // the player on foot is registered as a 0.6 m box
  return "other";
}

export function createHornBrain({ rnd = Math.random, maxHear = 140 } = {}) {
  const mem = new Map(); let lastAny = -1e9;
  const get = (id) => { let m = mem.get(id); if (!m) { m = { since: null, last: -1e9, n: 0, quietUntil: 0, warned: false, patience: 0.9 + rnd() * 1.3, wait: 4 + rnd() * 3.5 }; mem.set(id, m); } return m; };
  return {
    /**
     * id: a stable vehicle id. kind: "car"|"keke"|"bus"|"minibus". s: { v: speed m/s, lead: { gap, v, who } | null, waiting: at a junction's stop line, dist: metres from the listener }. now: seconds.
     * Returns null, or { pattern: "toot"|"double"|"long"|"peep" }.
     */
    consider(id, kind, s, now) {
      if (s.dist > maxHear) return null;
      const m = get(id), lead = s.lead, lk = lead ? leadKind(lead.who) : null;
      if (!lead || lead.gap > 15 || lk === "other") { m.since = null; m.warned = false; if (!lead) m.n = 0; return null; }
      if (now < m.quietUntil || now - lastAny < 1 || now - m.last < 9) return null;
      const person = PERSON.has(lk), k = kind === "keke" ? 0.7 : kind === "bus" ? 1.4 : 1;
      const go = (pattern) => { m.last = lastAny = now; m.n++; m.since = now; if (m.n >= 3) { m.quietUntil = now + 30; m.n = 0; } return { pattern: kind === "keke" ? "peep" : kind === "bus" && pattern !== "toot" ? "long" : pattern }; };
      if (person) {
        // coming up to someone in the road at speed: one warning toot per encounter
        if (!m.warned && s.v > 2.5 && lead.gap > 4 && lead.gap < 15 && rnd() < 0.85) { m.warned = true; return go("toot"); }
        // stopped for them and they are still there
        if (s.v < 1 && lead.gap < 8) { m.since ??= now; if (now - m.since > m.patience * k) return go(m.n ? "double" : "toot"); }
        else if (s.v >= 1) m.since = null;
        return null;
      }
      // stopped behind another vehicle that is not moving: impatience, mostly after a long wait, and rarely at a junction where everyone is waiting their turn
      if (lead.v < 0.3 && s.v < 0.5 && lead.gap < 8) {
        m.since ??= now; const need = m.wait * k * (s.waiting ? 4 : 1);
        if (now - m.since > need && rnd() < (s.waiting ? 0.2 : 0.55)) return go(rnd() < 0.3 ? "long" : "toot");
      } else m.since = null;
      return null;
    },
    forget(id) { mem.delete(id); },
    /** Drop what is known about vehicles that are no longer there (call with the set of ids alive now). */
    prune(alive) { for (const id of mem.keys()) if (!alive.has(id)) mem.delete(id); },
    get size() { return mem.size; },
  };
}
