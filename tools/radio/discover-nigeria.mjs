// tools/radio/discover-nigeria.mjs
// Finds NIGERIAN radio stations to try, from the radio-browser.info community directory, and writes them to tools/radio/candidates.json.
//
//   node tools/radio/discover-nigeria.mjs                 query the directory and add the best Nigerian candidates (max 60, at most 6 per state)
//   node tools/radio/discover-nigeria.mjs --max=80 --per-state=8
//   node tools/radio/discover-nigeria.mjs --dry           print what it would add and change nothing
//
// Run it on a machine with normal internet access. NOTHING it finds is in the game yet: a candidate only reaches public/data/radio-stations.json after
// tools/radio/verify-browser.mjs has really played it in a browser. The directory's own "working" flag is a hint, not proof.
//
// What it keeps: country code NG, flagged working by the directory, https stream (the game is https: an http stream is blocked as mixed content), not HLS, a codec a browser plays
// (MP3, AAC, Ogg). What it adds for the panel: the station's logo (the directory's favicon, https only) and its state, from which the region is worked out (lib/radio/stations.js).
// To spread the picks across the country it takes the most-listened stations of each state in turn, so Lagos cannot crowd out Kano, Enugu or Osun.
import fs from "node:fs";
import { cleanStation, regionOfState } from "../../lib/radio/stations.js";

const HOSTS = ["de1", "de2", "fi1", "at1", "nl1"].map((h) => `https://${h}.api.radio-browser.info`);
const CAND = new URL("./candidates.json", import.meta.url);
const CODEC = { mp3: "mp3", "aac": "aac", "aac+": "aac", ogg: "ogg", vorbis: "ogg" };

export const slug = (name) => String(name).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
const titleCase = (t) => String(t ?? "").trim().replace(/\b[a-z]/g, (c) => c.toUpperCase()).slice(0, 40);

/** One directory entry -> a candidate, or null when it does not meet the rules above. */
export function toCandidate(r) {
  if (!r || String(r.countrycode).toUpperCase() !== "NG") return null;            // Nigeria only
  if (Number(r.lastcheckok) !== 1 || Number(r.hls) === 1) return null;
  const codec = CODEC[String(r.codec ?? "").toLowerCase()]; if (!codec) return null;
  let url; try { url = new URL(r.url_resolved || r.url); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const name = String(r.name ?? "").replace(/\s+/g, " ").trim(); if (!name || !slug(name)) return null;
  const state = String(r.state ?? "").trim();
  let logo = ""; try { const f = new URL(r.favicon); if (f.protocol === "https:") logo = f.href; } catch { /* no logo */ }
  const home = /^https?:\/\//.test(r.homepage ?? "") ? r.homepage : "";
  const genre = titleCase(String(r.tags ?? "").split(",")[0]);
  return { id: slug(name), name: name.slice(0, 60), country: "Nigeria", state, city: "", genre, url: url.href, format: codec, homepage: home, logo, _clicks: Number(r.clickcount) || 0 };
}

/** The picks: best-listened first within each state, states taken in turn, no more than `perState` from one state and `max` overall. Duplicates (same id or same stream) are dropped. */
export function pick(rows, { max = 60, perState = 6 } = {}) {
  const seen = new Set(), seenUrl = new Set(), by = new Map();
  for (const c of rows.map(toCandidate).filter(Boolean).sort((a, b) => b._clicks - a._clicks)) {
    if (seen.has(c.id) || seenUrl.has(c.url)) continue; seen.add(c.id); seenUrl.add(c.url);
    const k = regionOfState(c.state) ? c.state.toLowerCase() : "(unplaced)"; (by.get(k) ?? by.set(k, []).get(k)).push(c);
  }
  const out = [], queues = [...by.values()].map((q) => q.slice(0, perState));
  for (let i = 0; out.length < max && queues.some((q) => q.length > i); i++) for (const q of queues) { if (q[i] && out.length < max) out.push(q[i]); }
  return out.map(({ _clicks, ...c }) => c).filter((c) => cleanStation(c));
}

async function fetchRows() {
  const qs = "countrycode=NG&hidebroken=true&order=clickcount&reverse=true&limit=600";
  let last; for (const h of HOSTS) { try { const r = await fetch(`${h}/json/stations/search?${qs}`, { headers: { "User-Agent": "LifeinOAU-Radio-Discover/1.0" }, signal: AbortSignal.timeout(20_000) }); if (r.ok) return await r.json(); last = `HTTP ${r.status}`; } catch (e) { last = e?.cause?.code ?? e?.message; } }
  throw new Error(`could not reach the radio-browser directory (${last}). Is this machine online?`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split("=")[1]) || d : d; };
  const rows = await fetchRows(), picked = pick(rows, { max: arg("max", 60), perState: arg("per-state", 6) });
  const states = new Set(picked.map((c) => c.state).filter(Boolean));
  console.log(`${rows.length} Nigerian entries in the directory; ${picked.length} candidates across ${states.size} state(s).`);
  for (const c of picked) console.log(`  ${c.id.padEnd(30)} ${(c.state || "?").padEnd(14)} ${regionOfState(c.state).padEnd(13)} ${c.format}  ${c.logo ? "logo" : "no logo"}`);
  if (process.argv.includes("--dry")) process.exit(0);
  const file = JSON.parse(fs.readFileSync(CAND, "utf8")), byId = new Map((file.candidates ?? []).map((c) => [c.id, c]));
  for (const c of picked) byId.set(c.id, { ...c, ...(byId.get(c.id) ?? {}) });   // hand-edited entries (a city, a better logo) win over the directory's
  fs.writeFileSync(CAND, JSON.stringify({ ...file, candidates: [...byId.values()] }, null, 2) + "\n");
  console.log(`\nWrote tools/radio/candidates.json (${byId.size} candidate(s)). Next: node tools/radio/verify-browser.mjs --write`);
}
