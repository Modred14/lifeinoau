// tests/e2e/radio.e2e.mjs
// The car radio in a REAL browser, with REAL audio. Not part of `npm test` (it needs Chromium and ffmpeg); run it with:   npm run test:radio
//
// What it does: starts a local server that (1) serves the game's real radio modules (lib/radio/*, lib/audio/mixer.js), (2) streams two real MP3 "stations" live, paced
// at their bitrate like an Icecast server (one a 440 Hz tone, the other 1000 Hz), and (3) lets the test drop or refuse connections. Then it drives the real engine in
// Chromium with real clicks (so the browser's autoplay rules apply, exactly as for a player) and checks what actually happens:
//   - the <audio> element really plays (currentTime moves) and the decoded sound really is the station's (measured with WebAudio: the 440 Hz peak, then the 1000 Hz peak),
//   - the SERVER sees at most one open connection at any time (no duplicate or leaked streams), also when switching stations quickly,
//   - pause / resume, next / previous, volume, mute, closing the panel (the engine does not depend on it), leaving the vehicle and coming back,
//   - a dropped stream reconnects by itself; after the reconnect attempts run out, the radio recovers when the network comes back.
// It runs twice: as desktop Chrome and as an emulated Android phone (Pixel 5: touch, mobile user agent). That is emulation, not a real device.
// Playwright is not a dependency of the game: install it where you run this (npm i -D playwright && npx playwright install chromium), or point PLAYWRIGHT_MODULE at it.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

// ---- two real MP3 files ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "radio-e2e-"));
for (const [n, hz] of [["a", 440], ["b", 1000]]) {
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=20`, "-b:a", "128k", path.join(tmp, n + ".mp3")]);
  if (r.status !== 0) { console.error("ffmpeg is needed to make the test audio:", String(r.stderr)); process.exit(2); }
}
const mp3 = { a: fs.readFileSync(path.join(tmp, "a.mp3")), b: fs.readFileSync(path.join(tmp, "b.mp3")) };

// ---- the local "radio server" ----
const open = { a: new Set(), b: new Set() }; let opened = 0, refuse = false;
const stationsFile = (port) => ({ stations: ["a", "b"].map((id, i) => ({ id: "test-" + id, name: "Test FM " + id.toUpperCase(), country: "Nowhere", genre: i ? "Tone 1000" : "Tone 440", url: `http://127.0.0.1:${port}/stream/${id}`, format: "mp3", meta: i ? "none" : "icy", verifiedAt: "2026-11-15" })) });
const MIME = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const m = /^\/stream\/(a|b)$/.exec(u.pathname);
  if (m) {
    if (refuse) { res.writeHead(503); res.end(); return; }
    const id = m[1], buf = mp3[id]; opened++; open[id].add(res);
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "icy-name": "Test FM " + id }); // like Icecast: no Content-Length, sent as it "airs"
    let pos = 0; const CH = 4096, tick = setInterval(() => { res.write(buf.subarray(pos, pos + CH)); pos = (pos + CH) % buf.length; }, Math.round((CH / 16000) * 1000 / 4)); // 4x real time: fills the browser's buffer quickly
    res.on("close", () => { clearInterval(tick); open[id].delete(res); }); return;
  }
  if (u.pathname === "/__stats") { res.end(JSON.stringify({ a: open.a.size, b: open.b.size, opened })); return; }
  if (u.pathname === "/__drop") { for (const s of [...open.a, ...open.b]) s.destroy(); res.end("ok"); return; }
  if (u.pathname === "/__refuse") { refuse = u.searchParams.get("on") === "1"; res.end("ok"); return; }
  if (u.pathname === "/data/radio-stations.json") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(stationsFile(server.address().port))); return; }
  if (u.pathname === "/api/radio/meta") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ title: u.searchParams.get("id") === "test-a" ? "Test Artist - Test Song" : "" })); return; }
  if (u.pathname === "/shim/react.js") { res.setHeader("Content-Type", "text/javascript"); res.end("export const useSyncExternalStore = () => { throw new Error('hooks are not used in this test'); };"); return; }
  if (u.pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body>
<script type="importmap">{"imports":{"react":"/shim/react.js"}}</script>
<script>window.__audios=[];const A=window.Audio;window.Audio=function(...a){const e=new A(...a);window.__audios.push(e);return e};window.Audio.prototype=A.prototype;</script>
<script type="module">
import * as R from "/lib/radio/radio.js"; import * as M from "/lib/audio/mixer.js";
window.R=R; window.M=M; R._setRetry([150,150,150,150,150]);
const act={power:()=>{R.setInVehicle(true);R.setPower(true)},off:()=>R.setPower(false),pause:()=>R.setPlaying(false),play:()=>R.setPlaying(true),next:()=>R.stepStation(1),prev:()=>R.stepStation(-1),
  pickA:()=>R.selectStation("test-a"),pickB:()=>R.selectStation("test-b"),getOut:()=>R.setInVehicle(false),getIn:()=>R.setInVehicle(true)};
for(const k in act){const b=document.createElement("button");b.textContent=k;b.id=k;b.style.cssText="width:90px;height:60px;margin:4px";b.addEventListener("click",act[k]);document.body.append(b)}
await R.initRadio(); window.ready=true;
</script>`);
    return;
  }
  const f = path.join(ROOT, u.pathname); // the game's real modules
  if (f.startsWith(path.join(ROOT, "lib")) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.setHeader("Content-Type", MIME[path.extname(f)] ?? "text/plain"); res.end(fs.readFileSync(f)); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const stats = async () => (await fetch(BASE + "/__stats")).json();
const until = async (what, fn, ms = 8000) => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 60)); } throw new Error("timed out waiting for: " + what + " (last: " + JSON.stringify(last) + ")"); };

let checks = 0; const ok = (name, cond, extra = "") => { assert.ok(cond, name + (extra ? ` [${extra}]` : "")); checks++; console.log("  ok  " + name); };

async function suite(label, contextOptions, mobile) {
  console.log(`\n== ${label} ==`);
  opened = 0; refuse = false; for (const s of [...open.a, ...open.b]) s.destroy(); // each suite starts from a quiet server
  const browser = await chromium.launch({ args: ["--mute-audio"] }), ctx = await browser.newContext(contextOptions), page = await ctx.newPage(), errors = [];
  // NOTE: no --autoplay-policy flag: the browser's real autoplay rules apply, so the first sound must come from a real click/tap.
  page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE); await page.waitForFunction(() => window.ready === true);
  const press = (id) => (mobile ? page.tap("#" + id) : page.click("#" + id));
  const rs = () => page.evaluate(() => { const s = R.getRadio(); return { on: s.on, paused: s.paused, status: s.status, station: s.stationId, artist: s.artist, track: s.track, n: s.stations.length }; });
  const au = () => page.evaluate(() => { const e = window.__audios[0]; return e ? { t: e.currentTime, paused: e.paused, ready: e.readyState, vol: e.volume, src: e.getAttribute("src"), count: window.__audios.length } : null; });
  const advances = async (ms = 700) => { const a = (await au()).t; await page.waitForTimeout(ms); return (await au()).t > a + 0.2; };
  // what the decoded sound actually is: the strongest frequency (Hz) and its level, read with WebAudio from the same <audio> element the radio uses
  const tap = () => page.evaluate(async () => { const e = window.__audios[0]; if (!window.__an) { const c = new AudioContext(); await c.resume(); const s = c.createMediaElementSource(e), an = c.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0; s.connect(an); an.connect(c.destination); window.__an = an; window.__ctx = c; } });
  const hear = () => page.evaluate(async () => { await new Promise((r) => setTimeout(r, 300)); const an = window.__an, d = new Float32Array(an.frequencyBinCount), t = new Float32Array(an.fftSize); let sum = 0, n = 12;
    for (let i = 0; i < n; i++) { an.getFloatTimeDomainData(t); let q = 0; for (const x of t) q += x * x; sum += Math.sqrt(q / t.length); await new Promise((r) => setTimeout(r, 40)); }
    an.getFloatFrequencyData(d); let k = 0; for (let i = 1; i < d.length; i++) if (d[i] > d[k]) k = i; return { hz: Math.round((k * window.__ctx.sampleRate) / an.fftSize), db: Math.round(d[k]), rms: sum / n }; });

  ok("the stations load from the station file", (await rs()).n === 2);
  ok("nothing plays and no audio element exists before the first press (no sound without a person's tap)", (await au()) === null && (await stats()).opened === 0);

  // 1-3: open, pick a station, hear music
  await press("power");
  await until("playing", async () => (await rs()).status === "playing");
  ok("pressing power starts the first station: status is playing", true);
  ok("the audio element is really playing: currentTime moves, not paused, has data", (await au()).ready >= 3 && !(await au()).paused && (await advances()));
  await tap(); const a = await hear();
  ok("the decoded sound is the station's 440 Hz audio, well above silence (a muted signal measures zero)", Math.abs(a.hz - 440) < 30 && a.db > -70, JSON.stringify(a));
  ok("what is playing is shown (track information from the station)", (await until("track", async () => (await rs()).track === "Test Song")) && (await rs()).artist === "Test Artist");
  ok("the server has exactly one open stream", (await stats()).a === 1 && (await stats()).b === 0);

  // 9-10: change stations: the old one stops, the new one plays, never two
  await press("next"); await until("station b playing", async () => (await rs()).station === "test-b" && (await rs()).status === "playing");
  const b = await hear(); ok("next station: now it is the 1000 Hz audio", Math.abs(b.hz - 1000) < 30 && b.db > -70, JSON.stringify(b));
  await until("a closed", async () => (await stats()).a === 0); ok("the previous station's connection was closed, only the new one is open", (await stats()).a === 0 && (await stats()).b === 1);
  for (const id of ["pickA", "pickB", "pickA", "pickB", "pickA", "pickB"]) await press(id); // quick switching
  await until("settled on b", async () => (await rs()).station === "test-b" && (await rs()).status === "playing"); await page.waitForTimeout(400);
  const s1 = await stats(); ok("after six quick switches there is still only ONE open connection on the server", s1.a + s1.b === 1 && s1.b === 1, JSON.stringify(s1));
  ok("and still ONE audio element in the page (no duplicate instances)", (await au()).count === 1);
  await press("prev"); await until("a playing", async () => (await rs()).station === "test-a" && (await rs()).status === "playing"); ok("previous station goes back", true);

  // 4: pause / resume
  await press("pause"); await until("paused", async () => (await rs()).status === "paused");
  await until("closed", async () => { const s = await stats(); return s.a + s.b === 0; }); ok("pause stops the sound and releases the connection (no data used while paused)", (await au()).src === null);
  await press("play"); await until("playing again", async () => (await rs()).status === "playing"); ok("resume plays again and it really advances", await advances());
  const c = await hear(); ok("and it is the right station's sound again", Math.abs(c.hz - 440) < 30 && c.db > -70, JSON.stringify(c));

  // 5-6: volume and mute are real (the element's volume follows the mixer)
  await page.evaluate(() => M.setMix({ radioVolume: 30, masterVolume: 100, masterMute: false }));
  ok("volume 30% is applied to the audio element", Math.abs((await au()).vol - 0.3) < 0.01);
  const quiet = await hear(); await page.evaluate(() => M.setMix({ radioVolume: 100 })); const loud = await hear();
  ok("a higher volume gives a proportionally louder signal (30% -> 100% is about 3.3x)", loud.rms / quiet.rms > 2.5 && loud.rms / quiet.rms < 4.5, `rms ${quiet.rms.toFixed(4)} -> ${loud.rms.toFixed(4)}`);
  await page.evaluate(() => M.setMix({ masterMute: true })); ok("muting (master) sets the element volume to 0", (await au()).vol === 0);
  const muted = await hear(); ok("and the measured sound is silent", muted.rms < 0.0005, JSON.stringify(muted));
  await page.evaluate(() => M.setMix({ masterMute: false })); const un = await hear(); ok("unmuting brings the sound back", un.rms > 0.005 && (await au()).vol > 0.9, JSON.stringify(un));

  // 7-8: leaving the vehicle is the game's own rule (the panel itself is React and is not part of this test)
  await press("getOut"); await until("stopped", async () => { const s = await stats(); return s.a + s.b === 0; });
  ok("getting out of the vehicle stops the stream (the game's design)", (await rs()).status === "idle" && (await au()).src === null);
  await press("getIn"); await until("resumed", async () => (await rs()).status === "playing"); ok("getting back in resumes the radio", await advances());

  // network: a dropped stream reconnects by itself
  const before = (await stats()).opened; await fetch(BASE + "/__drop");
  await until("reconnected", async () => (await stats()).opened > before && (await rs()).status === "playing"); ok("a dropped stream reconnects on its own and plays again", await advances());
  ok("...with one connection only", (await stats()).a + (await stats()).b === 1);
  // network: the server stays away until the attempts run out; then the network comes back
  await fetch(BASE + "/__refuse?on=1"); await fetch(BASE + "/__drop");
  await until("gave up", async () => (await rs()).status === "error", 12000); ok("when the station stays away the radio stops trying and says so", /Press play/.test((await page.evaluate(() => R.getRadio().error))));
  await fetch(BASE + "/__refuse?on=0"); await ctx.setOffline(true); await page.waitForTimeout(150); await ctx.setOffline(false);
  await until("recovered", async () => (await rs()).status === "playing", 8000); ok("when the network comes back (online event) the radio recovers by itself, with no button press", await advances());
  ok("...still only one stream", (await stats()).a + (await stats()).b === 1);

  // a station that is down or blocked: it must say so within seconds (not after half a minute), and the player can still pick another or retry
  await fetch(BASE + "/__refuse?on=1"); await fetch(BASE + "/__drop"); await page.waitForTimeout(100);
  const t0 = Date.now(); await press("pickB");
  await until("unavailable", async () => (await rs()).status === "error", 6000); ok("a station that never makes a sound is reported unavailable within a few seconds (its message tells the player what to do)", Date.now() - t0 < 4000 && /isn't available/.test(await page.evaluate(() => R.getRadio().error)), `${Date.now() - t0} ms`);
  await fetch(BASE + "/__refuse?on=0"); await press("pickA"); await until("another station works", async () => (await rs()).status === "playing" && (await rs()).station === "test-a"); ok("picking another station afterwards works, with one stream only", (await advances()) && (await stats()).a + (await stats()).b === 1);

  // power off closes everything
  await press("off"); await until("all closed", async () => { const s = await stats(); return s.a + s.b === 0; }); ok("switching the radio off closes the stream", (await rs()).status === "off");
  ok("no page errors or console errors during the whole run", errors.length === 0, errors.join(" | "));
  await browser.close();
}

try {
  await suite("desktop Chrome", { viewport: { width: 1280, height: 800 } }, false);
  await suite("Android Chrome (Pixel 5 emulation)", { ...devices["Pixel 5"] }, true);
  console.log(`\n${checks} real-browser radio checks passed`);
} catch (e) { console.error("\nFAILED:", e.message); process.exitCode = 1; }
finally { server.closeAllConnections?.(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
