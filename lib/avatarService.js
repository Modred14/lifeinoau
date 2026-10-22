// lib/avatarService.js
// What a screen needs to draw other players' profile pictures: their saved gender + look, by name.
// The appearance is already public (every player sees everyone's character in the world and in /api/profile), so this reveals nothing new.
// One batch read answers a whole list (a leaderboard, an inbox, a contact list) instead of one request per row.
import { cleanLook, lookKey } from "./look.js";

export const MAX_NAMES = 60; // one screen's worth; the browser splits bigger lists
const NAME_MAX = 20; // the longest a player name can be (lib/profileRules.js)

/** The distinct, plausible names out of whatever the browser sent. Anything else is dropped, never trusted. */
export function cleanNames(raw) {
  const seen = new Map();
  for (const n of Array.isArray(raw) ? raw : []) {
    const s = String(n ?? "").trim();
    if (s.length < 1 || s.length > NAME_MAX) continue;
    const k = s.toLowerCase();
    if (!seen.has(k)) seen.set(k, s);
    if (seen.size >= MAX_NAMES) break;
  }
  return [...seen.values()];
}

/** { players: { [lowercase name]: { name, gender, look, key } } } for every name that is a real player. Unknown names are simply absent. */
export async function getAvatarLooks(db, rawNames) {
  const names = cleanNames(rawNames), players = {};
  if (!names.length) return { players };
  const rows = await db.character.findMany({
    where: { OR: names.map((n) => ({ name: { equals: n, mode: "insensitive" } })) },
    select: { name: true, gender: true, look: true },
  });
  for (const r of rows) {
    const g = r.gender === "F" ? "F" : "M", look = cleanLook(r.look, g);
    players[r.name.toLowerCase()] = { name: r.name, gender: g, look, key: lookKey(look, g) };
  }
  return { players };
}
