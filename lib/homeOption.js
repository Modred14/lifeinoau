// lib/homeOption.js
// What the map needs to draw the player's own home compound: the room (its size and kind), the things placed outdoors, and the vehicles they own. Loaded from the same endpoints the home screen uses
// (/api/room, /api/rides), so the compound on the map is the one they decorated and parked in. Client side.
import { call } from "./client";
import { roomFor } from "./room.js";

// The answer is kept for a few seconds (and dropped the moment the game says things changed) so the map, which asks for it again on arrival, gets what the home screen's preload already fetched.
const KEEP_MS = 30000; let kept = null;
if (typeof window !== "undefined") window.addEventListener("game:refresh", () => { kept = null; });
const keyOf = (ch, id) => `${ch?.id ?? ""}|${ch?.hostel ?? ""}|${id || ch?.activeCar || ""}`;
/** Starts loading the home option now so the map finds it ready. Resolves to the same value as loadHomeOption. */
export function primeHomeOption(ch, activeModelId = "", { fresh = false } = {}) { if (fresh) kept = null; return loadHomeOption(ch, activeModelId); }
/** The room, its items or the vehicles changed on the home screen: what was kept is out of date. */
export function forgetHomeOption() { kept = null; }

/** { room, items, vehicles: [{ id, modelId, color }], seed, activeId } for the character, or null when nothing can be loaded. Never throws. */
export async function loadHomeOption(ch, activeModelId = "") {
  const k = keyOf(ch, activeModelId); if (kept && kept.k === k && Date.now() - kept.at < KEEP_MS) return kept.p;
  const p = loadHomeOptionNow(ch, activeModelId); kept = { k, at: Date.now(), p }; p.then((v) => { if (!v && kept?.p === p) kept = null; });
  return p;
}
async function loadHomeOptionNow(ch, activeModelId = "") {
  try {
    const [rm, rd] = await Promise.all([call("/api/room"), call("/api/rides")]);
    const room = (!rm.failed && rm.room) || roomFor(ch.hostel), items = (!rm.failed && rm.items) || [];
    const vehicles = !rd.failed && Array.isArray(rd.owned) ? rd.owned.map((o) => ({ id: o.modelId, modelId: o.modelId, color: o.color, saved: o.park ?? null })) : [];
    return { room, items, vehicles, seed: String(ch.id ?? ch.name ?? ""), activeId: activeModelId || ch.activeCar || null };
  } catch { return null; }
}
