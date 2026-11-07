// src/app/api/radio/meta/route.js
// GET /api/radio/meta?id=<station id>  ->  { title, name }   what is playing on a radio station right now.
// The browser cannot read a stream's track information from an <audio> element, so this reads it for the player: it opens the station's stream asking for its metadata
// (lib/radio/icy.js), reads just the first block, and closes the connection. Safety rules, because this makes the server open a URL:
//   - the id must be one of OUR stations (public/data/radio-stations.json): the URL is never taken from the request, so this cannot be pointed at anything else,
//   - you must be logged in, the answer is cached for 20 s per station (so any number of players cost one upstream request per station per 20 s),
//   - 6 s timeout, at most ~70 KB read, and a station with no track information is remembered for 10 minutes and not asked again.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getUserId } from "@/lib/auth";
import { cleanStations } from "@/lib/radio/stations";
import { parseStreamTitle, readIcyBlock } from "@/lib/radio/icy";
export const dynamic = "force-dynamic";
const cache = (globalThis.__radioMeta ??= new Map());   // id -> { at, ttl, body }
const NONE = { title: "", name: "" };

async function stations() { try { return cleanStations(JSON.parse(await readFile(path.join(process.cwd(), "public", "data", "radio-stations.json"), "utf8"))); } catch { return []; } }

export async function GET(req) {
  if (!(await getUserId())) return Response.json({ error: "Please log in." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "", s = (await stations()).find((x) => x.id === id);
  if (!s || s.meta !== "icy") return Response.json(NONE);
  const hit = cache.get(id); if (hit && Date.now() - hit.at < hit.ttl) return Response.json(hit.body);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000); let body = NONE, ttl = 20_000;
  try {
    const r = await fetch(s.url, { headers: { "Icy-MetaData": "1", "User-Agent": "LifeinOAU-Radio/1.0" }, signal: ctl.signal, redirect: "follow", cache: "no-store" });
    const metaint = parseInt(r.headers.get("icy-metaint") ?? "", 10), name = r.headers.get("icy-name") ?? "";
    if (!r.ok || !r.body || !Number.isInteger(metaint)) { ttl = 10 * 60_000; body = { title: "", name }; }
    else { const rd = r.body.getReader(); const block = await readIcyBlock(async () => { const { value, done } = await rd.read(); return done ? null : value; }, metaint); try { await rd.cancel(); } catch { /* closed */ } body = { title: block ? parseStreamTitle(block) : "", name }; }
  } catch { ttl = 60_000; } finally { clearTimeout(timer); ctl.abort(); }
  cache.set(id, { at: Date.now(), ttl, body });
  return Response.json(body);
}
