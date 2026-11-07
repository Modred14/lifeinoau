// tools/radio/verify-stations.mjs
// Decides which radio stations may be in the game. A station is added ONLY if its stream really works, checked here, from a machine with normal internet access:
//
//   node tools/radio/verify-stations.mjs                 check every candidate in tools/radio/candidates.json and print a report (changes nothing)
//   node tools/radio/verify-stations.mjs --write         ...and put the ones that pass into public/data/radio-stations.json (existing entries are re-checked too)
//   node tools/radio/verify-stations.mjs --check         re-check the stations already in the game (use it on a schedule: streams move and die) and exit 1 if any failed
//   --allow-http                                         accept http:// streams (they cannot play on the https site: the game skips them, so this is only for testing)
//
// What "works" means: the server answers 200, within 10 s sends at least 16 KB, and those bytes really ARE audio (an MP3 frame, ADTS AAC or an Ogg page: not an HTML page, a
// playlist or an error message with an audio content type). It also notes whether the stream carries track information (Icy metadata) so the radio can show what is playing.
// Respect each station's terms: candidates must be streams the station publishes for public listening; nothing here records or stores audio, it reads ~16 KB and disconnects.
import fs from "node:fs";
import { cleanStation } from "../../lib/radio/stations.js";
import { parseStreamTitle, readIcyBlock } from "../../lib/radio/icy.js";

const args = new Set(process.argv.slice(2)), CAND = new URL("./candidates.json", import.meta.url), OUT = new URL("../../public/data/radio-stations.json", import.meta.url);
const read = (u) => JSON.parse(fs.readFileSync(u, "utf8"));
const need = 16 * 1024, TIMEOUT = 10_000;

/** What kind of audio these first bytes are: "mp3" | "aac" | "ogg" | "hls" | null. */
export function sniff(b) {
  if (b.length < 4) return null;
  const txt = new TextDecoder().decode(b.slice(0, 16));
  if (txt.startsWith("#EXTM3U")) return "hls";
  if (txt.startsWith("OggS")) return "ogg";
  let i = 0; if (txt.startsWith("ID3")) { i = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)); if (i + 4 > b.length) return "mp3"; }
  for (let k = i; k < Math.min(b.length - 1, i + 4096); k++) { if (b[k] !== 0xff) continue; const n = b[k + 1]; if ((n & 0xf6) === 0xf0) return "aac"; if ((n & 0xe0) === 0xe0 && (n & 0x18) !== 0x08 && (n & 0x06) !== 0) return "mp3"; }
  return null;
}

export async function check(s, { allowHttp = false } = {}) {
  const res = { id: s.id, ok: false, why: "", format: null, meta: "none", title: "", contentType: "" };
  let u; try { u = new URL(s.url); } catch { res.why = "not a URL"; return res; }
  if (u.protocol === "http:" && !allowHttp) { res.why = "http:// stream: it cannot play on the https game (mixed content). Ask the station for an https URL"; return res; }
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(u, { headers: { "Icy-MetaData": "1", "User-Agent": "LifeinOAU-Radio-Verify/1.0" }, signal: ctl.signal, redirect: "follow" });
    res.contentType = r.headers.get("content-type") ?? ""; if (!r.ok) { res.why = `HTTP ${r.status}`; return res; }
    if (/text\/html/i.test(res.contentType)) { res.why = "returns a web page, not audio"; return res; }
    const rd = r.body.getReader(), metaint = parseInt(r.headers.get("icy-metaint") ?? "", 10); let got = new Uint8Array(0);
    const next = async () => { const { value, done } = await rd.read(); return done ? null : value; };
    while (got.length < need) { const c = await next(); if (!c) break; const n = new Uint8Array(got.length + c.length); n.set(got); n.set(c, got.length); got = n; }
    if (got.length < need) { res.why = `only ${got.length} bytes in ${TIMEOUT / 1000} s (not a live stream)`; return res; }
    const kind = sniff(got); if (!kind) { res.why = "the bytes are not MP3, AAC or Ogg audio"; return res; } if (kind === "hls") { res.why = "an HLS playlist: <audio> cannot play it outside Safari"; return res; }
    res.format = kind;
    if (Number.isInteger(metaint) && metaint > 0) { res.meta = "icy"; try { const r2 = await fetch(u, { headers: { "Icy-MetaData": "1" }, signal: ctl.signal }); const rd2 = r2.body.getReader(); const blk = await readIcyBlock(async () => { const { value, done } = await rd2.read(); return done ? null : value; }, metaint); res.title = blk ? parseStreamTitle(blk) : ""; await rd2.cancel(); } catch { /* the stream works; the title just was not readable */ } }
    try { await rd.cancel(); } catch { /* closed */ }
    res.ok = true; return res;
  } catch (e) { res.why = e?.name === "AbortError" ? `timed out after ${TIMEOUT / 1000} s` : `${e?.cause?.code ?? e?.message ?? e}`; return res; } finally { clearTimeout(timer); ctl.abort(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const existing = read(OUT).stations ?? [], cands = args.has("--check") ? [] : (read(CAND).candidates ?? []).filter((c) => c && c.url);
  const byId = new Map(); for (const s of [...existing, ...cands]) byId.set(s.id, { ...(byId.get(s.id) ?? {}), ...s });
  const all = [...byId.values()]; if (!all.length) { console.log("Nothing to check: add stations to tools/radio/candidates.json."); process.exit(0); }
  const pass = [], fail = [];
  for (const s of all) { const r = await check(s, { allowHttp: args.has("--allow-http") }); console.log(`${r.ok ? "PASS" : "FAIL"}  ${s.id.padEnd(22)} ${r.ok ? `${r.format} · ${r.meta === "icy" ? "track info" + (r.title ? ` ("${r.title.slice(0, 40)}")` : "") : "no track info"}` : r.why}`);
    if (r.ok) { const clean = cleanStation({ ...s, format: r.format, meta: r.meta, verifiedAt: new Date().toISOString().slice(0, 10) }); if (clean) pass.push(clean); else fail.push([s.id, "incomplete entry (needs id, name, url)"]); } else fail.push([s.id, r.why]); }
  console.log(`\n${pass.length} stream(s) work, ${fail.length} do not.`);
  if (args.has("--write")) { fs.writeFileSync(OUT, JSON.stringify({ _readme: read(OUT)._readme, stations: pass }, null, 2) + "\n"); console.log(`Wrote ${pass.length} station(s) to public/data/radio-stations.json (failed ones are left out).`); }
  else if (pass.length) console.log("Run again with --write to add the working ones to the game.");
  process.exit(args.has("--check") && fail.length ? 1 : 0);
}
