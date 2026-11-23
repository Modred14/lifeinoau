// tools/radio/verify-browser.mjs
// Decides which Nigerian radio stations may be in the game, by PLAYING them in a real browser. An HTTP 200 proves nothing about audio (a stream can answer 200 and send a web page, a
// playlist, silence, or something the browser cannot decode), so this is the check that counts.
//
//   node tools/radio/verify-browser.mjs                  test every candidate (tools/radio/candidates.json) and every station already in the game; print a report, change nothing
//   node tools/radio/verify-browser.mjs --write          ...and make public/data/radio-stations.json exactly the stations that passed (the ones that failed are removed)
//   node tools/radio/verify-browser.mjs --check          re-test only the stations already in the game (run it on a schedule: streams move and die); exit 1 if one failed
//   --file=path.json        test the stations of another file ({ stations: [...] } or { candidates: [...] }) instead
//   --seconds=10            how long each stream must keep playing (default 10)     --timeout=25   how long it may take to make its first sound (default 25)
//   --parallel=3            stations tested at the same time, each in its own browser context (default 3)     --retries=1   a failure is tried again this many times before it counts
//   --no-mobile             skip the phone profile      --allow-http   accept http:// streams (they cannot play on the https game: for testing only)
//
// What it does for each station:
//   1. a quick request: it must answer 200 with real MP3 / AAC / Ogg bytes (tools/radio/verify-stations.mjs), which also tells us the format and whether it carries track information;
//   2. then the REAL game radio (lib/radio/radio.js) is started in Chromium by a real click (so the browser's autoplay rules apply, as for a player), once as desktop Chrome and once as an
//      emulated Android phone (Pixel 5: touch, mobile user agent; emulation, not a real device). To pass, the station must reach "playing", then for --seconds the media clock must keep
//      advancing (at least 60 % of real time), the browser must keep decoding audio bytes (webkitAudioDecodedByteCount grows), the element must report no error, and the radio must not
//      have had to reconnect. Only one audio element ever exists, and it is torn down between stations.
//   3. its logo (if any) must really load as an image; a logo that does not is dropped (the panel shows initials instead).
// What it CANNOT tell: whether the sound is music rather than silence or a recorded message (a cross-origin stream cannot be analysed). A person should listen to the final list once.
//
// Playwright is not a dependency of the game. Install it where you run this:  npm i -D playwright && npx playwright install chromium
// (Chromium's bundled build may not decode AAC: for AAC stations set PLAYWRIGHT_CHANNEL=chrome to use an installed Google Chrome.) Other env: PLAYWRIGHT_MODULE, PLAYWRIGHT_EXECUTABLE.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanStation, cleanStations } from "../../lib/radio/stations.js";
import { check } from "./verify-stations.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url)), CAND = new URL("./candidates.json", import.meta.url), OUT = new URL("../../public/data/radio-stations.json", import.meta.url);
const args = process.argv.slice(2), flag = (k) => args.includes(`--${k}`), val = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const SECONDS = Number(val("seconds", 10)), TIMEOUT = Number(val("timeout", 25)), PARALLEL = Math.max(1, Number(val("parallel", 3))), RETRIES = Math.max(0, Number(val("retries", 1)));
const read = (u) => JSON.parse(fs.readFileSync(u, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The verdict on one sample series: did it really play for the time it was watched? Pure, so it is tested without a browser. */
export function judge({ first, last, watchedMs, audio }) {
  if (!first || !last) return { ok: false, why: "no audio element" };
  if (last.status !== "playing") return { ok: false, why: `stopped playing (status: ${last.status}${last.error ? ", " + last.error : ""})` };
  if (last.mediaError) return { ok: false, why: `the browser reported a media error (code ${last.mediaError})` };
  if (last.attempt > 0) return { ok: false, why: "it had to reconnect while playing" };
  const advanced = last.t - first.t; if (advanced < (watchedMs / 1000) * 0.6) return { ok: false, why: `the clock advanced only ${advanced.toFixed(1)} s in ${(watchedMs / 1000).toFixed(0)} s (stalling)` };
  if (last.dec !== null && first.dec !== null && last.dec <= first.dec) return { ok: false, why: "no audio bytes were decoded (silent or undecodable)" };
  if (audio !== 1) return { ok: false, why: `${audio} audio elements exist (should be exactly one)` };
  return { ok: true, why: "", advanced, decoded: last.dec !== null && first.dec !== null ? last.dec - first.dec : null };
}

/** Is this logo a real, reasonably small image? */
async function logoWorks(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "LifeinOAU-Radio-Verify/1.0" } }); if (!r.ok) return false; const t = r.headers.get("content-type") ?? ""; const n = Number(r.headers.get("content-length") ?? 0); return /^image\//i.test(t) && n < 600_000; } catch { return false; }
}

async function main() {
  // ---- what to test ----
  const live = read(OUT).stations ?? [], from = val("file", ""), source = from ? read(from) : null;
  const cands = flag("check") || source ? [] : (read(CAND).candidates ?? []).filter((c) => c && c.url);
  const byId = new Map(); for (const s of [...(source ? source.stations ?? source.candidates ?? [] : live), ...cands]) byId.set(s.id, { ...(byId.get(s.id) ?? {}), ...s });
  const report = [], todo = [];
  for (const raw of byId.values()) { const s = cleanStation(raw); if (!s) report.push({ id: String(raw.id), ok: false, why: "not a valid NIGERIAN station entry (needs id, name, https url, country Nigeria)" }); else todo.push(s); }
  if (!todo.length && !report.length) { console.log("Nothing to test: run tools/radio/discover-nigeria.mjs first, or add stations to tools/radio/candidates.json."); return 0; }

  // ---- 1. a quick request: real audio bytes ----
  const quick = await Promise.all(todo.map((s) => check(s, { allowHttp: flag("allow-http") })));
  const alive = []; todo.forEach((s, i) => { const q = quick[i]; if (q.ok) alive.push({ ...s, format: q.format, meta: q.meta }); else report.push({ id: s.id, ok: false, why: `stream check: ${q.why}` }); });
  console.log(`${alive.length} of ${todo.length} streams answer with real audio bytes; playing them in a browser now (${SECONDS} s each, ${PARALLEL} at a time)...\n`);

  // ---- 2. the real radio, in a real browser ----
  const { chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright").catch(() => { console.error("Playwright is not installed: npm i -D playwright && npx playwright install chromium"); process.exit(2); });
  const launch = { args: ["--mute-audio"] }; if (process.env.PLAYWRIGHT_CHANNEL) launch.channel = process.env.PLAYWRIGHT_CHANNEL; if (process.env.PLAYWRIGHT_EXECUTABLE) launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
  // NOTE: no --autoplay-policy flag: the browser's real autoplay rules apply, so the first sound must come from a real click / tap.
  const MIME = { ".js": "text/javascript", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/data/radio-stations.json") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ stations: alive })); return; }
    if (u.pathname === "/shim/react.js") { res.setHeader("Content-Type", "text/javascript"); res.end("export const useSyncExternalStore = () => { throw new Error('hooks are not used here'); };"); return; }
    if (u.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body>
<script type="importmap">{"imports":{"react":"/shim/react.js"}}</script>
<script>window.__audios=[];const A=window.Audio;window.Audio=function(...a){const e=new A(...a);window.__audios.push(e);return e};window.Audio.prototype=A.prototype;</script>
<script type="module">
import * as R from "/lib/radio/radio.js"; window.R=R;
const b=document.createElement("button");b.id="go";b.textContent="play";b.style.cssText="width:120px;height:80px";b.addEventListener("click",()=>{R.setInVehicle(true);R.selectStation(window.__target)});document.body.append(b);
const o=document.createElement("button");o.id="off";o.textContent="off";o.style.cssText="width:120px;height:80px";o.addEventListener("click",()=>R.setPower(false));document.body.append(o);
await R.initRadio(); window.ready=true;
</script>`); return; }
    const f = path.join(ROOT, u.pathname);
    if (f.startsWith(path.join(ROOT, "lib")) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.setHeader("Content-Type", MIME[path.extname(f)] ?? "text/plain"); res.end(fs.readFileSync(f)); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r)); const BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(launch);
  const profiles = [["desktop", { viewport: { width: 1280, height: 800 } }, false], ...(flag("no-mobile") ? [] : [["phone", { ...devices["Pixel 5"] }, true]])];

  async function play(s, [name, opts, mobile]) {
    const ctx = await browser.newContext(opts), page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(BASE); await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
      await page.evaluate((id) => { window.__target = id; }, s.id);
      await (mobile ? page.tap("#go") : page.click("#go"));   // a real click / tap: the autoplay rules apply
      const t0 = Date.now(); let st = "";
      while (Date.now() - t0 < TIMEOUT * 1000) { st = await page.evaluate(() => R.getRadio().status); if (st === "playing" || st === "error" || st === "tap" || st === "nostation") break; await sleep(250); }
      const ttfs = Date.now() - t0;
      if (st !== "playing") { const err = await page.evaluate(() => R.getRadio().error); return { ok: false, why: `${name}: it never started playing (${st === "tap" ? "the browser blocked autoplay" : st || "timed out after " + TIMEOUT + " s"}${err ? ": " + err : ""})` }; }
      const snap = () => page.evaluate(() => { const e = window.__audios[0], r = R.getRadio(); return { t: e.currentTime, dec: typeof e.webkitAudioDecodedByteCount === "number" ? e.webkitAudioDecodedByteCount : null, status: r.status, error: r.error, attempt: r.attempt, mediaError: e.error ? e.error.code : 0, n: window.__audios.length }; });
      const first = await snap(), w0 = Date.now(); await sleep(SECONDS * 1000); const last = await snap(), v = judge({ first, last, watchedMs: Date.now() - w0, audio: last.n });
      await page.click("#off").catch(() => {});
      return v.ok ? { ok: true, why: "", ttfs, ...v, name } : { ok: false, why: `${name}: ${v.why}` };
    } catch (e) { return { ok: false, why: `${name}: ${String(e.message).split("\n")[0]}` }; } finally { await ctx.close().catch(() => {}); }
  }
  async function verify(s) {
    let last; for (let attempt = 0; attempt <= RETRIES; attempt++) {
      const got = []; for (const p of profiles) { const r = await play(s, p); got.push(r); if (!r.ok) break; }
      last = got.find((r) => !r.ok) ?? { ok: true, ttfs: Math.max(...got.map((g) => g.ttfs)), advanced: got[0].advanced, decoded: got[0].decoded };
      if (last.ok) break;
    }
    return last;
  }
  const queue = [...alive], results = new Map();
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => { for (let s; (s = queue.shift()); ) { const r = await verify(s); results.set(s.id, r); console.log(`${r.ok ? "PASS" : "FAIL"}  ${s.id.padEnd(30)} ${r.ok ? `first sound ${(r.ttfs / 1000).toFixed(1)} s, played ${r.advanced.toFixed(1)} s${r.decoded !== null ? `, ${(r.decoded / 1024).toFixed(0)} KB decoded` : ""}, desktop${profiles.length > 1 ? " + phone" : ""}` : r.why}`); } }));
  await browser.close(); server.closeAllConnections?.(); server.close();

  // ---- 3. logos, then the list ----
  const passed = []; for (const s of alive) { const r = results.get(s.id); if (!r?.ok) { report.push({ id: s.id, ok: false, why: r?.why ?? "not tested" }); continue; }
    let logo = s.logo; if (logo && !(await logoWorks(logo))) { console.log(`      ${s.id}: logo does not load, dropped (the panel shows initials)`); logo = ""; }
    const clean = cleanStation({ ...s, logo, verifiedAt: new Date().toISOString().slice(0, 10) }); if (clean) passed.push(clean); }
  for (const r of report.filter((x) => !x.ok && !results.has(x.id))) console.log(`FAIL  ${r.id.padEnd(30)} ${r.why}`);
  const regions = new Set(passed.map((s) => s.region)), states = new Set(passed.map((s) => s.state || s.city).filter(Boolean));
  console.log(`\n${passed.length} station(s) really play, ${report.length} do not. Covering ${regions.size} region(s): ${[...regions].join(", ") || "none"}; ${states.size} state(s)/city(ies).`);
  if (flag("write")) {
    if (!passed.length && !flag("allow-empty")) { console.log("No station passed (is this machine offline?): public/data/radio-stations.json was NOT changed. Use --allow-empty to write an empty list."); return 1; }
    fs.writeFileSync(OUT, JSON.stringify({ _readme: read(OUT)._readme, stations: cleanStations({ stations: passed }) }, null, 2) + "\n");
    console.log(`Wrote ${passed.length} station(s) to public/data/radio-stations.json.`);
  } else if (passed.length) console.log("Run again with --write to make these the game's stations.");
  return flag("check") && report.some((x) => !x.ok) ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
