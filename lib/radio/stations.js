// lib/radio/stations.js
// The radio station directory, as data. Stations live in public/data/radio-stations.json (so adding one is a data change, not a code change) and only stations that PASSED the
// stream check (tools/radio/verify-stations.mjs) belong there: it opens every stream, checks it really is audio, and records when. This module validates what it is given, so a
// bad entry is dropped quietly instead of breaking the radio, and works out which stations this browser can actually play.
//
// A station: { id, name, country, city?, genre, url, format ("mp3"|"aac"|"ogg"), homepage, meta ("icy"|"none"), verifiedAt (ISO date) }
export const STATIONS_URL = "/data/radio-stations.json";
const FORMATS = { mp3: "audio/mpeg", aac: "audio/aac", ogg: "audio/ogg" };

export function cleanStation(s) {
  if (!s || typeof s !== "object") return null;
  const id = String(s.id ?? "").trim().toLowerCase(), name = String(s.name ?? "").trim().slice(0, 60);
  let url; try { url = new URL(String(s.url ?? "")); } catch { return null; }
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || !name || !/^https?:$/.test(url.protocol) || url.username || url.password || !s.verifiedAt) return null;
  return { id, name, country: String(s.country ?? "").slice(0, 40), city: String(s.city ?? "").slice(0, 40), genre: String(s.genre ?? "").slice(0, 40), url: url.href, format: FORMATS[s.format] ? s.format : "mp3", homepage: /^https?:\/\//.test(s.homepage ?? "") ? s.homepage : "", meta: s.meta === "icy" ? "icy" : "none", verifiedAt: String(s.verifiedAt) };
}
/** The valid stations of a file's contents ({ stations: [...] }), without duplicates, in the file's order. */
export function cleanStations(json) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(json?.stations) ? json.stations : []) { const s = cleanStation(raw); if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); } }
  return out;
}
/** Can this browser play this station? An http stream cannot be played from an https page (mixed content), and the browser must know the format. */
export function playable(s, { protocol = "https:", canPlay = () => "maybe" } = {}) {
  if (protocol === "https:" && s.url.startsWith("http:")) return false;
  return canPlay(FORMATS[s.format] ?? "audio/mpeg") !== "";
}
