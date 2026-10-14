// lib3d/campusData.js
// Loads the real-map data and joins it with the game's own place details (blurbs and actions in landmarks.js). Pure helpers: no 3D library.
import { LANDMARKS, KIND_LABEL } from "./landmarks.js";
import { withExtras, EXTRA_META } from "./mapExtras.js";

let cache;
/** Fetches /data/oau-campus.json once and adds the game-only places (Ojaja, Floor O, clubs, billboards). A failed load is not cached, so a retry can succeed. */
export const loadCampusData = () => (cache ??= fetch("/data/oau-campus.json").then((r) => { if (!r.ok) throw new Error("map data " + r.status); return r.json(); }).then(withExtras).catch((e) => { cache = undefined; throw e; }));

/** Game details by place id: { blurb, actions, verified }. New real-map places get a plain default blurb. */
export function placeMeta(data) {
  const meta = { ...Object.fromEntries(LANDMARKS.map((l) => [l.id, { blurb: l.blurb, actions: l.actions, verified: l.verified }])), ...EXTRA_META };
  for (const p of data.places) if (!meta[p.id]) meta[p.id] = { blurb: `${KIND_LABEL[p.kind] ?? "Place"} on the OAU campus.`, actions: [], verified: false };
  return meta;
}

/** Every place the player can pick: those with a position on the real map, then the game places that no reference could locate. */
export function listPlaces(data) {
  const meta = placeMeta(data), located = data.places.map((p) => ({ ...meta[p.id], id: p.id, name: p.name, kind: p.kind, tier: p.tier, conf: p.conf, located: true }));
  const ids = new Set(located.map((p) => p.id)), unlocated = data.gameOnly.filter((g) => !ids.has(g.id)).map((g) => ({ ...meta[g.id], id: g.id, name: g.name, kind: g.kind, tier: 3, conf: "game-only", located: false }));
  return [...located, ...unlocated];
}

/** One line telling the player how far to trust a place's position. */
export function trustNote(p) {
  if (!p.located) return "";
  if (p.conf === "game") return "";
  if (p.conf === "approximate") return "";
  return "";
}