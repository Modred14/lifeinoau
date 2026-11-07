// tests/radio.test.mjs
// The car radio (lib/radio/*), headless with a fake <audio>: only ever one stream, switching stations, play/pause, power, reconnecting with a delay then giving up,
// playing only while in a vehicle, remembering the last station, and the pure parts (station validation, mixed-content rule, stream metadata, stream sniffing).
import assert from "node:assert/strict";
import { cleanStation, cleanStations, playable } from "../lib/radio/stations.js";
import { parseStreamTitle, splitTitle, readIcyBlock } from "../lib/radio/icy.js";
import { sniff } from "../tools/radio/verify-stations.mjs";
let n = 0; const ok = (name, cond) => { assert.ok(cond, name); n++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- stations ----
const good = { id: "demo-fm", name: "Demo FM", url: "https://example.com/live.mp3", format: "mp3", meta: "icy", verifiedAt: "2026-11-01" };
ok("a verified station is accepted", cleanStation(good)?.id === "demo-fm");
ok("a station that was never verified is not", cleanStation({ ...good, verifiedAt: "" }) === null);
ok("no id, no name, a bad URL, a non-http URL or one with a password are all rejected", [{ ...good, id: "" }, { ...good, name: "" }, { ...good, url: "nope" }, { ...good, url: "ftp://x/y" }, { ...good, url: "https://u:p@x.com/a" }, { ...good, id: "Has Space" }].every((s) => cleanStation(s) === null));
ok("duplicates are dropped and bad entries skipped, order kept", cleanStations({ stations: [good, { ...good, name: "Again" }, null, { id: "b", name: "B", url: "https://b.com/s", verifiedAt: "x" }] }).map((s) => s.id).join() === "demo-fm,b");
ok("nonsense input gives an empty list, not an error", cleanStations(null).length === 0 && cleanStations({ stations: "x" }).length === 0 && cleanStations({}).length === 0);
ok("an http stream cannot play on an https page, but can on http", !playable({ url: "http://a/b", format: "mp3" }, { protocol: "https:" }) && playable({ url: "http://a/b", format: "mp3" }, { protocol: "http:" }));
ok("a format the browser cannot play is skipped", !playable({ url: "https://a/b", format: "aac" }, { protocol: "https:", canPlay: () => "" }) && playable({ url: "https://a/b", format: "aac" }, { protocol: "https:", canPlay: () => "maybe" }));

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
globalThis.document = { hidden: false, createElement: () => ({ canPlayType: () => "maybe" }), addEventListener() {} }; globalThis.addEventListener = () => {};
globalThis.fetch = async (u) => (String(u).includes("/data/radio-stations.json") ? { ok: true, json: async () => stationsFile } : { ok: true, json: async () => ({ title: "Wizkid - Essence" }) });
const R = await import("../lib/radio/radio.js"), el = () => R.getRadio();
await R.initRadio();
ok("the stations load and the first is chosen; the radio starts off", R.getRadio().stations.length === 3 && R.getRadio().stationId === "demo-fm" && !R.getRadio().on && R.getRadio().status === "off");
R.setInVehicle(true); R.setPower(true); await wait(5);
ok("switching on plays the chosen station", R.getRadio().on && log.src.at(-1) === "https://example.com/live.mp3" && R.getRadio().status === "loading");
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
// ---- no stations ----
{ const empty = { stations: [] }; globalThis.fetch = async () => ({ ok: true, json: async () => empty }); mem.clear(); await R.initRadio(); R.setInVehicle(true); R.setPower(true);
  ok("with no stations the radio says so clearly and plays nothing", R.getRadio().status === "nostation" && R.getRadio().stations.length === 0 && log.violations === 0); R._resetRadio(); }
console.log(`${n} radio checks passed`);
