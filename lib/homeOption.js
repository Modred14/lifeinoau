// lib/homeOption.js
// What the map needs to draw the player's own home compound: the room (its size and kind), the things placed outdoors, and the vehicles they own. Loaded from the same endpoints the home screen uses
// (/api/room, /api/rides), so the compound on the map is the one they decorated and parked in. Client side.
import { call } from "./client";
import { roomFor } from "./room.js";

/** { room, items, vehicles: [{ id, modelId, color }], seed, activeId } for the character, or null when nothing can be loaded. Never throws. */
export async function loadHomeOption(ch, activeModelId = "") {
  try {
    const [rm, rd] = await Promise.all([call("/api/room"), call("/api/rides")]);
    const room = (!rm.failed && rm.room) || roomFor(ch.hostel), items = (!rm.failed && rm.items) || [];
    const vehicles = !rd.failed && Array.isArray(rd.owned) ? rd.owned.map((o) => ({ id: o.modelId, modelId: o.modelId, color: o.color })) : [];
    return { room, items, vehicles, seed: String(ch.id ?? ch.name ?? ""), activeId: activeModelId || ch.activeCar || null };
  } catch { return null; }
}
