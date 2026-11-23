// lib/radio/stations.js
// The radio station directory, as data. Stations live in public/data/radio-stations.json (so adding one is a data change, not a code change). This module validates what it is
// given, so a bad entry is dropped quietly instead of breaking the radio, and works out which stations this browser can actually play.
//
// LifeinOAU's radio is NIGERIAN ONLY. That is enforced here, not just in the data: a station whose country is not Nigeria is rejected by cleanStation(), so it cannot be listed,
// played, or promoted by the verification tools, however it got into a file.
//
// A station: { id, name, country (must be "Nigeria"), state?, city?, region?, genre, url, format ("mp3"|"aac"|"ogg"), homepage, logo?, meta ("icy"|"none"), verifiedAt (ISO date, optional) }
//   - region is one of REGIONS; when it is missing it is worked out from the state (or city, when that is a state's name), and a station that cannot be placed is "National".
//   - logo is an https image URL. It is optional: the panel shows the station's initials when there is none, or when the image does not load.
// A station is admitted to the live list ONLY by tools/radio/verify-browser.mjs, which plays it in a real browser. A station that fails at play time says so and can be skipped,
// so a stream that is down never takes the whole radio with it.
export const STATIONS_URL = "/data/radio-stations.json";
const FORMATS = { mp3: "audio/mpeg", aac: "audio/aac", ogg: "audio/ogg" };

/** The country every station must have. */
export const COUNTRY = "Nigeria";
/** The six geopolitical zones, then stations that serve the whole country. This is also the order the panel lists them in. */
export const REGIONS = ["South-West", "South-South", "South-East", "North-Central", "North-West", "North-East", "National"];
const ZONES = {
  "South-West": ["lagos", "ogun", "oyo", "osun", "ondo", "ekiti"],
  "South-South": ["akwa ibom", "bayelsa", "cross river", "delta", "edo", "rivers"],
  "South-East": ["abia", "anambra", "ebonyi", "enugu", "imo"],
  "North-Central": ["benue", "kogi", "kwara", "nasarawa", "niger", "plateau", "fct", "abuja", "federal capital territory"],
  "North-West": ["jigawa", "kaduna", "kano", "katsina", "kebbi", "sokoto", "zamfara"],
  "North-East": ["adamawa", "bauchi", "borno", "gombe", "taraba", "yobe"],
};
const STATE_REGION = new Map(Object.entries(ZONES).flatMap(([region, states]) => states.map((s) => [s, region])));
/** The zone a state belongs to ("Oyo" -> "South-West", "Abuja" / "FCT" -> "North-Central"), or "" when it is not a Nigerian state. A trailing "State" is ignored. */
export function regionOfState(state) {
  const k = String(state ?? "").trim().toLowerCase().replace(/\s+state$/, "");
  return STATE_REGION.get(k) ?? "";
}
const isNigeria = (c) => /^(nigeria|ng)$/i.test(String(c ?? "").trim());

export function cleanStation(s) {
  if (!s || typeof s !== "object") return null;
  if (!isNigeria(s.country)) return null;   // Nigerian stations only
  const id = String(s.id ?? "").trim().toLowerCase(), name = String(s.name ?? "").trim().slice(0, 60);
  let url; try { url = new URL(String(s.url ?? "")); } catch { return null; }
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || !name || !/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  let logo = ""; try { const l = new URL(String(s.logo ?? "")); if (l.protocol === "https:" && !l.username && !l.password && l.href.length <= 300) logo = l.href; } catch { /* no logo */ }
  const state = String(s.state ?? "").trim().slice(0, 40), city = String(s.city ?? "").trim().slice(0, 40);
  const region = REGIONS.includes(s.region) ? s.region : regionOfState(state) || regionOfState(city) || "National";
  return { id, name, country: COUNTRY, state, city, region, genre: String(s.genre ?? "").slice(0, 40), url: url.href, format: FORMATS[s.format] ? s.format : "mp3", homepage: /^https?:\/\//.test(s.homepage ?? "") ? s.homepage : "", logo, meta: s.meta === "icy" ? "icy" : "none", verifiedAt: String(s.verifiedAt ?? "") };
}
/** The valid Nigerian stations of a file's contents ({ stations: [...] }), without duplicates, grouped by region (REGIONS order) and otherwise in the file's order. */
export function cleanStations(json) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(json?.stations) ? json.stations : []) { const s = cleanStation(raw); if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); } }
  return out.map((s, i) => [s, i]).sort((a, b) => REGIONS.indexOf(a[0].region) - REGIONS.indexOf(b[0].region) || a[1] - b[1]).map(([s]) => s);
}
/** Where a station is, for display: its city, else its state ("Ibadan", "Oyo"), else "". */
export const placeOf = (s) => s.city || s.state || "";
/** Stations grouped for the panel: [{ region, stations }], regions in REGIONS order, empty regions left out. The flat order matches cleanStations(), so next / previous follow what is on screen. */
export function groupStations(list) {
  return REGIONS.map((region) => ({ region, stations: list.filter((s) => s.region === region) })).filter((g) => g.stations.length);
}
/** Can this browser play this station? An http stream cannot be played from an https page (mixed content), and the browser must know the format. */
export function playable(s, { protocol = "https:", canPlay = () => "maybe" } = {}) {
  if (protocol === "https:" && s.url.startsWith("http:")) return false;
  return canPlay(FORMATS[s.format] ?? "audio/mpeg") !== "";
}
