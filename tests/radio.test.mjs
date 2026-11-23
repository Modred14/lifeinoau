// tests/radio.test.mjs
// The car radio (lib/radio/*), headless with a fake <audio>: only ever one stream, switching stations, play/pause, power, reconnecting with a delay then giving up,
// playing only while in a vehicle, remembering the last station, and the pure parts (station validation, mixed-content rule, stream metadata, stream sniffing).
import assert from "node:assert/strict";
import { cleanStation, cleanStations, playable, groupStations, regionOfState, REGIONS } from "../lib/radio/stations.js";
import { parseStreamTitle, splitTitle, readIcyBlock } from "../lib/radio/icy.js";
import { sniff } from "../tools/radio/verify-stations.mjs";
import { judge } from "../tools/radio/verify-browser.mjs";
import { toCandidate, pick, slug } from "../tools/radio/discover-nigeria.mjs";
import { channel, MIX_DEFAULTS, RADIO_LEVEL } from "../lib/audio/mixer.js";
import { readFileSync } from "node:fs";
let n = 0; const ok = (name, cond) => { assert.ok(cond, name); n++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- stations ----
const good = { id: "demo-fm", name: "Demo FM", country: "Nigeria", url: "https://example.com/live.mp3", format: "mp3", meta: "icy", verifiedAt: "2026-11-01" };
ok("a verified station is accepted", cleanStation(good)?.id === "demo-fm");
ok("a station that has not been stamped by the stream check yet is still listed (verifiedAt is optional)", cleanStation({ ...good, verifiedAt: "" })?.id === "demo-fm" && cleanStation({ ...good, verifiedAt: undefined })?.verifiedAt === "");
ok("no id, no name, a bad URL, a non-http URL or one with a password are all rejected", [{ ...good, id: "" }, { ...good, name: "" }, { ...good, url: "nope" }, { ...good, url: "ftp://x/y" }, { ...good, url: "https://u:p@x.com/a" }, { ...good, id: "Has Space" }].every((s) => cleanStation(s) === null));
ok("duplicates are dropped and bad entries skipped, order kept", cleanStations({ stations: [good, { ...good, name: "Again" }, null, { id: "b", name: "B", country: "Nigeria", url: "https://b.com/s", verifiedAt: "x" }] }).map((s) => s.id).join() === "demo-fm,b");
ok("nonsense input gives an empty list, not an error", cleanStations(null).length === 0 && cleanStations({ stations: "x" }).length === 0 && cleanStations({}).length === 0);
ok("an http stream cannot play on an https page, but can on http", !playable({ url: "http://a/b", format: "mp3" }, { protocol: "https:" }) && playable({ url: "http://a/b", format: "mp3" }, { protocol: "http:" }));
ok("a format the browser cannot play is skipped", !playable({ url: "https://a/b", format: "aac" }, { protocol: "https:", canPlay: () => "" }) && playable({ url: "https://a/b", format: "aac" }, { protocol: "https:", canPlay: () => "maybe" }));

// ---- Nigerian stations only ----
ok("a station from any other country, or with no country, is rejected (this is what keeps the radio Nigerian)", [{ ...good, country: "United States" }, { ...good, country: "Ghana" }, { ...good, country: "United Kingdom" }, { ...good, country: "" }, { ...good, country: undefined }, { ...good, country: "Nigeria Online" }].every((s) => cleanStation(s) === null));
ok("Nigeria is accepted however it is written, and is stored as Nigeria", ["Nigeria", " nigeria ", "NG", "ng"].every((c) => cleanStation({ ...good, country: c })?.country === "Nigeria"));
ok("the five stations the radio used to have (SomaFM x3, Radio Paradise, NTS, KEXP) can never come back", cleanStations({ stations: [["somafm-groove-salad", "United States"], ["somafm-fluid", "United States"], ["radio-paradise", "United States"], ["nts-1", "United Kingdom"], ["kexp", "United States"]].map(([id, country]) => ({ id, name: id, country, url: `https://x.example/${id}` })) }).length === 0);
{ const file = JSON.parse(readFileSync(new URL("../public/data/radio-stations.json", import.meta.url), "utf8")), raw = file.stations ?? [];
  ok("every station in the game's station file is a valid Nigerian station (none is dropped by validation)", cleanStations(file).length === raw.length && raw.every((s) => /^(nigeria|ng)$/i.test(s.country)));
  ok("every station in the game's file was verified in a browser (it has a verifiedAt date) and uses https", raw.every((s) => /^\d{4}-\d\d-\d\d$/.test(s.verifiedAt ?? "") && s.url.startsWith("https://")));
  const cands = JSON.parse(readFileSync(new URL("../tools/radio/candidates.json", import.meta.url), "utf8")).candidates ?? [];
  ok("no candidate is from another country", cands.every((c) => /^(nigeria|ng)$/i.test(c.country)));
  ok("every candidate is a valid Nigerian station entry on an https stream that is not an HLS playlist, with a unique id and stream", cands.every((c) => cleanStation(c) && c.url.startsWith("https://") && !/\.m3u8/i.test(c.url)) && new Set(cands.map((c) => c.id)).size === cands.length && new Set(cands.map((c) => c.url)).size === cands.length);
  ok("the candidates cover several regions, so the verified list can too", new Set(cands.map((c) => cleanStation(c)?.region)).size >= (cands.length ? 5 : 0)); }
ok("the region comes from the state: Oyo is South-West, Abuja / FCT North-Central, Kano North-West, Enugu South-East, Rivers South-South, Borno North-East", regionOfState("Oyo") === "South-West" && regionOfState("Abuja") === "North-Central" && regionOfState("FCT") === "North-Central" && regionOfState("Kano State") === "North-West" && regionOfState("Enugu") === "South-East" && regionOfState("Rivers") === "South-South" && regionOfState("Borno") === "North-East" && regionOfState("Atlantis") === "");
ok("a station takes its region from its state (or city), an explicit valid region wins, and one that cannot be placed is National", cleanStation({ ...good, state: "Osun" }).region === "South-West" && cleanStation({ ...good, city: "Lagos" }).region === "South-West" && cleanStation({ ...good, state: "Osun", region: "National" }).region === "National" && cleanStation({ ...good, region: "Mars" }).region === "National" && cleanStation(good).region === "National");
ok("a logo is kept only if it is an https image address; otherwise the station simply has none", cleanStation({ ...good, logo: "https://x.example/l.png" }).logo === "https://x.example/l.png" && cleanStation({ ...good, logo: "http://x.example/l.png" }).logo === "" && cleanStation({ ...good, logo: "javascript:alert(1)" }).logo === "" && cleanStation({ ...good, logo: "data:image/png;base64,AAAA" }).logo === "" && cleanStation({ ...good, logo: "https://u:p@x.example/l.png" }).logo === "" && cleanStation(good).logo === "");
{ const mk = (id, state) => ({ ...good, id, name: id.toUpperCase(), state, url: `https://x.example/${id}` });
  const list = cleanStations({ stations: [mk("kano-1", "Kano"), mk("lagos-1", "Lagos"), mk("nat-1", ""), mk("enugu-1", "Enugu"), mk("lagos-2", "Lagos"), mk("ph-1", "Rivers"), mk("borno-1", "Borno"), mk("abuja-1", "Abuja")] });
  ok("stations are ordered by region (South-West, South-South, South-East, North-Central, North-West, North-East, National) and keep the file's order inside a region", list.map((s) => s.id).join() === "lagos-1,lagos-2,ph-1,enugu-1,abuja-1,kano-1,borno-1,nat-1");
  const g = groupStations(list);
  ok("the panel's groups hold exactly those stations, in the same order (so next / previous follow the screen), and empty regions are left out", g.flatMap((x) => x.stations).map((s) => s.id).join() === list.map((s) => s.id).join() && g.map((x) => x.region).join() === "South-West,South-South,South-East,North-Central,North-West,North-East,National" && groupStations(list.filter((s) => s.region === "South-West")).length === 1);
  ok("the region list is the six zones plus National", REGIONS.length === 7 && REGIONS.at(-1) === "National"); }

// ---- finding and verifying Nigerian stations (the pure parts of the tools) ----
{ const row = (o) => ({ name: "Test FM", url_resolved: "https://s.example/live", countrycode: "NG", lastcheckok: 1, hls: 0, codec: "MP3", state: "Lagos", favicon: "https://s.example/f.png", tags: "pop,news", clickcount: 10, homepage: "https://s.example", ...o });
  ok("a working https Nigerian MP3 station becomes a candidate with its logo, state and genre", (() => { const c = toCandidate(row({})); return c && c.id === "test-fm" && c.country === "Nigeria" && c.state === "Lagos" && c.logo === "https://s.example/f.png" && c.format === "mp3" && c.genre === "Pop"; })());
  ok("another country, a stream flagged broken, an HLS playlist, an http stream and an unplayable codec are all refused", [row({ countrycode: "GH" }), row({ countrycode: "US" }), row({ lastcheckok: 0 }), row({ hls: 1 }), row({ url_resolved: "http://s.example/live" }), row({ codec: "WMA" }), row({ name: "" }), row({ url_resolved: "nope" })].every((r) => toCandidate(r) === null));
  const many = [...["Lagos", "Lagos", "Lagos", "Lagos", "Lagos", "Lagos", "Lagos", "Lagos"].map((st, i) => row({ name: `Lagos Station ${i}`, url_resolved: `https://s.example/l${i}`, state: st, clickcount: 1000 - i })), row({ name: "Kano One", url_resolved: "https://s.example/k1", state: "Kano", clickcount: 5 }), row({ name: "Enugu One", url_resolved: "https://s.example/e1", state: "Enugu", clickcount: 4 }), row({ name: "Ghana One", url_resolved: "https://s.example/g1", state: "Accra", countrycode: "GH", clickcount: 9999 }), row({ name: "Lagos Station 0", url_resolved: "https://s.example/dupe", state: "Lagos" })];
  const picked = pick(many, { max: 10, perState: 3 });
  ok("the picks are spread over the states (Lagos cannot crowd out Kano or Enugu), capped per state, with no duplicate and nothing from Ghana", picked.filter((c) => c.state === "Lagos").length === 3 && picked.some((c) => c.state === "Kano") && picked.some((c) => c.state === "Enugu") && !picked.some((c) => /ghana/i.test(c.name)) && new Set(picked.map((c) => c.id)).size === picked.length && picked.every((c) => cleanStation(c)));
  ok("ids are clean slugs", slug("Cool FM 96.9 — Lagos!") === "cool-fm-96-9-lagos" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(slug("É'lé Ọ̀ṣun Radio"))); }
{ const play = (t, dec) => ({ t, dec, status: "playing", error: "", attempt: 0, mediaError: 0 });
  ok("the browser verdict: a stream whose clock advances and whose bytes decode passes", judge({ first: play(1, 1000), last: play(10.5, 90000), watchedMs: 10000, audio: 1 }).ok);
  ok("...a stalled clock, no decoded bytes, a media error, a reconnect, a stopped radio, or two audio elements each fail", [judge({ first: play(1, 1000), last: play(2, 5000), watchedMs: 10000, audio: 1 }), judge({ first: play(1, 1000), last: play(10, 1000), watchedMs: 10000, audio: 1 }), judge({ first: play(1, 1), last: { ...play(10, 9), mediaError: 4 }, watchedMs: 10000, audio: 1 }), judge({ first: play(1, 1), last: { ...play(10, 9), attempt: 1 }, watchedMs: 10000, audio: 1 }), judge({ first: play(1, 1), last: { ...play(10, 9), status: "error", error: "x" }, watchedMs: 10000, audio: 1 }), judge({ first: play(1, 1), last: play(10, 9), watchedMs: 10000, audio: 2 }), judge({ first: null, last: null, watchedMs: 1, audio: 0 })].every((v) => !v.ok));
  ok("...and a browser that does not report decoded bytes is judged on the clock alone", judge({ first: play(1, null), last: play(10, null), watchedMs: 10000, audio: 1 }).ok); }

// ---- the radio has no volume control: a fixed level ----
ok("the radio plays at a fixed sensible level (80 %), whatever an old saved volume says: a saved 0 cannot silence it", RADIO_LEVEL === 0.8 && channel("radio", { ...MIX_DEFAULTS }) === 0.8 && channel("radio", { ...MIX_DEFAULTS, radioVolume: 0 }) === 0.8 && !("radioVolume" in MIX_DEFAULTS));
ok("only the player's master volume and master mute reach the radio", Math.abs(channel("radio", { ...MIX_DEFAULTS, masterVolume: 50 }) - 0.4) < 1e-9 && channel("radio", { ...MIX_DEFAULTS, masterMute: true }) === 0 && channel("radio", { ...MIX_DEFAULTS, engineMute: true, townMute: true, hornMute: true }) === 0.8);

// ---- track information ----
ok("the title is read from a metadata block", parseStreamTitle("StreamTitle='Burna Boy - Last Last';StreamUrl='';") === "Burna Boy - Last Last");
ok("an apostrophe inside a title is kept", parseStreamTitle("StreamTitle='Don't Stop - Artist';StreamUrl='http://x';") === "Don't Stop - Artist");
ok("no title gives an empty string", parseStreamTitle("") === "" && parseStreamTitle("StreamUrl='x';") === "");
ok("artist and track are split; a title with no dash is just the track", JSON.stringify(splitTitle("Wizkid - Essence")) === '{"artist":"Wizkid","track":"Essence"}' && splitTitle("Evening News").track === "Evening News" && splitTitle("Evening News").artist === "");
ok("empty or placeholder titles are not shown", splitTitle("") === null && splitTitle("  ") === null && splitTitle("Unknown") === null && splitTitle("x".repeat(300)) === null);
{ const enc = (s) => new TextEncoder().encode(s), meta = "StreamTitle='A - B';", len = Math.ceil(meta.length / 16), blk = new Uint8Array(1 + len * 16); blk[0] = len; blk.set(enc(meta), 1);
  const audio = new Uint8Array(100).fill(7), whole = new Uint8Array([...audio, ...blk, ...audio]);
  const chunked = (b, size) => { let i = 0; return async () => (i >= b.length ? null : b.slice(i, (i += size))); };
  ok("a metadata block is found however the bytes arrive", (await readIcyBlock(chunked(whole, 100), 100)).startsWith("StreamTitle='A - B'") && (await readIcyBlock(chunked(whole, 7), 100)).startsWith("StreamTitle='A - B'") && (await readIcyBlock(chunked(whole, 1000), 100)).startsWith("StreamTitle"));
  ok("an empty block gives an empty string; a stream that ends early gives null; a silly interval is refused", (await readIcyBlock(chunked(new Uint8Array([...audio, 0]), 50), 100)) === "" && (await readIcyBlock(chunked(audio.slice(0, 50), 10), 100)) === null && (await readIcyBlock(chunked(whole, 100), 999999)) === null && (await readIcyBlock(chunked(whole, 100), 0)) === null); }

// ---- the verifier's idea of "real audio" ----
ok("it recognises MP3 (with and without a tag), AAC and Ogg", sniff(new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4])) === "mp3" && sniff(new Uint8Array([0xff, 0xf1, 0x50, 0x80, 1, 2])) === "aac" && sniff(new TextEncoder().encode("OggS\0\x02abcdefgh")) === "ogg");
ok("it recognises an MP3 stream that starts with an ID3 tag", sniff(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 9, 9, 9, 9, 0xff, 0xfb, 0x90, 0])) === "mp3");
ok("an HTML error page, a playlist, or random bytes are not audio", sniff(new TextEncoder().encode("<html><body>Not found</body></html>")) === null && sniff(new TextEncoder().encode("#EXTM3U\n#EXT-X-VERSION:3")) === "hls" && sniff(new Uint8Array(64).fill(1)) === null);

// ---- the player, with a fake <audio> ----
const log = { src: [], violations: 0, plays: 0, loads: 0 }, made = [];
class FakeAudio { constructor() { this.l = {}; this._src = null; this.volume = 1; this.paused = true; made.push(this); }
  setAttribute() {} addEventListener(e, f) { (this.l[e] ??= []).push(f); } emit(e) { for (const f of this.l[e] ?? []) f(); }
  set src(v) { if (this._src) log.violations++; this._src = v; log.src.push(v); } get src() { return this._src; }
  getAttribute(k) { return k === "src" ? this._src : null; } removeAttribute(k) { if (k === "src") this._src = null; }
  play() { log.plays++; this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } load() { log.loads++; } }
const mem = new Map(), stationsFile = { stations: [good, { ...good, id: "two", name: "Two FM", url: "https://example.com/two.mp3", meta: "none" }, { ...good, id: "three", name: "Three FM", url: "https://example.com/three.mp3", meta: "none" }] };
globalThis.window = globalThis; globalThis.Audio = FakeAudio; globalThis.location = { protocol: "https:" };
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
globalThis.document = { hidden: false, createElement: () => ({ canPlayType: () => "maybe" }), addEventListener() {} }; const winL = {}; globalThis.addEventListener = (e, f) => (winL[e] ??= []).push(f);
mem.set("lifeinoau:mix", JSON.stringify({ radioVolume: 0, masterVolume: 100 }));   // a volume saved by the old radio slider, at its lowest: it must not matter
globalThis.fetch = async (u) => (String(u).includes("/data/radio-stations.json") ? { ok: true, json: async () => stationsFile } : { ok: true, json: async () => ({ title: "Wizkid - Essence" }) });
const R = await import("../lib/radio/radio.js"), el = () => R.getRadio();
await R.initRadio();
ok("the stations load and the first is chosen; the radio starts off", R.getRadio().stations.length === 3 && R.getRadio().stationId === "demo-fm" && !R.getRadio().on && R.getRadio().status === "off");
R.setInVehicle(true); R.setPower(true); await wait(5);
ok("switching on plays the chosen station", R.getRadio().on && log.src.at(-1) === "https://example.com/live.mp3" && R.getRadio().status === "loading");
ok("the stream starts at the fixed 80 % level even with a stale saved volume of 0 (the radio is not accidentally muted)", made[0].volume === 0.8);
R.selectStation("two"); R.selectStation("three"); R.selectStation("demo-fm"); R.selectStation("two");
ok("switching stations quickly never has two streams at once (the old source is always removed first)", log.violations === 0 && log.src.at(-1) === "https://example.com/two.mp3");
ok("the new station is what the panel shows", R.getRadio().stationId === "two");
R.stepStation(1); ok("next goes to the next station, wrapping at the end", R.getRadio().stationId === "three"); R.stepStation(1); ok("...round to the first", R.getRadio().stationId === "demo-fm"); R.stepStation(-1); ok("previous goes back", R.getRadio().stationId === "three");
R.selectStation("demo-fm"); await wait(30);
ok("a station with track information shows what is playing", R.getRadio().artist === "Wizkid" && R.getRadio().track === "Essence");
R.setPlaying(false); ok("pause releases the stream (no data used) but the radio stays on", R.getRadio().on && R.getRadio().status === "paused" && log.src.at(-1) === "https://example.com/live.mp3");
{ const before = log.src.length; R.setPlaying(true); await wait(5); ok("play starts it again", log.src.length === before + 1 && R.getRadio().status === "loading"); }
R.setPower(false); ok("switching off stops everything", R.getRadio().status === "off" && !R.getRadio().on);
{ const before = log.src.length; R.setInVehicle(false); R.setInVehicle(true); await wait(5); ok("with the radio off, getting into a vehicle plays nothing", log.src.length === before); }
R.setPower(true); await wait(5); { const before = log.src.length; R.setInVehicle(false); ok("getting out of the vehicle stops the stream", R.getRadio().status === "idle" || R.getRadio().status === "off"); R.setInVehicle(true); await wait(5); ok("getting back in resumes the radio that was on", log.src.length === before + 1 && R.getRadio().on); }
ok("on/off and the last station are remembered", JSON.parse(mem.get("lifeinoau:radio")).on === true && JSON.parse(mem.get("lifeinoau:radio")).stationId === "demo-fm");
// a dropped stream reconnects after a delay, then gives up with a message
{ R._setRetry([15, 15, 15, 15, 15]); const e = made[0]; R.setPower(false); R.setPower(true); await wait(5); const base = log.src.length;
  e.emit("playing"); ok("when the stream plays, the status is playing", R.getRadio().status === "playing");
  e.emit("error"); ok("a dropped stream is reconnecting, with a reason", R.getRadio().status === "reconnecting" && /stopped/.test(R.getRadio().error) && e.getAttribute("src") === null);
  await wait(40); ok("and it reconnects to the same station on its own, with one stream", log.src.length === base + 1 && log.src.at(-1) === "https://example.com/live.mp3" && log.violations === 0);
  e.emit("playing"); ok("a successful reconnect resets the count", R.getRadio().status === "playing" && R.getRadio().attempt === 0);
  let tries = 0; for (let i = 0; i < 8 && R.getRadio().status !== "error"; i++) { e.emit("error"); await wait(40); tries++; }
  ok("after six failed attempts it stops and says so (and how to retry), using no data", R.getRadio().status === "error" && /Press play/.test(R.getRadio().error) && e.getAttribute("src") === null && tries === 6);
  R.setPlaying(false); R.setPlaying(true); await wait(5); ok("pressing play after that tries again", R.getRadio().status === "loading" && e.getAttribute("src") !== null);
  R.setPower(false); const frozen = log.src.length; e.emit("error"); e.emit("ended"); await wait(40); ok("events from a stream that was switched off are ignored (nothing restarts it)", R.getRadio().status === "off" && log.src.length === frozen);
  R.setPower(true); await wait(5); e.emit("waiting"); ok("a stall shows buffering", R.getRadio().status === "buffering"); e.emit("ended"); ok("a stream that ends is treated as dropped", R.getRadio().status === "reconnecting"); await wait(40); R.setPower(false); }
ok("there was never more than one stream at a time", log.violations === 0);
R._resetRadio();
// ---- the station list cannot be loaded (offline), then the network comes back ----
{ mem.clear(); const down = async () => { throw new TypeError("Failed to fetch"); }; globalThis.fetch = down; await R.initRadio(); R.setInVehicle(true);
  ok("offline at startup: no stations, and the panel is told the list failed (not that there are none)", R.getRadio().stations.length === 0 && R.getRadio().listFailed === true && R.getRadio().loaded === true);
  globalThis.fetch = async (u) => (String(u).includes("/data/radio-stations.json") ? { ok: true, json: async () => stationsFile } : { ok: true, json: async () => ({ title: "" }) });
  for (const f of winL.online ?? []) f(); await wait(20);
  ok("when the network comes back the stations load by themselves", R.getRadio().stations.length === 3 && R.getRadio().listFailed === false && R.getRadio().stationId === "demo-fm");
  const before = log.src.length; R.setPower(true); await wait(5); ok("and the radio plays one of them", log.src.length === before + 1 && R.getRadio().on && log.violations === 0); R._resetRadio(); }
// ---- no stations ----
{ const empty = { stations: [] }; globalThis.fetch = async () => ({ ok: true, json: async () => empty }); mem.clear(); await R.initRadio(); R.setInVehicle(true); R.setPower(true);
  ok("with no stations the radio says so clearly and plays nothing", R.getRadio().status === "nostation" && R.getRadio().stations.length === 0 && log.violations === 0); R._resetRadio(); }
console.log(`${n} radio checks passed`);
