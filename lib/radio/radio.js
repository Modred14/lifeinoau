// lib/radio/radio.js
// The car radio: one player for the whole game. Plain module state + subscribe (like lib/sound.js), read by components/CarRadio.js with useRadio().
//
//   - ONE <audio> element, reused for every station. Before any new stream starts the old one is torn down completely (pause, remove the source, load()), which is what
//     closes its connection: switching stations quickly, or turning the radio off, can never leave two streams playing or one downloading in the background.
//   - Power (the radio is on or off) is separate from Play/Pause (a paused radio is on, with its stream released, so it uses no data).
//   - A stream that stalls, errors or ends is reconnected with a growing delay (1, 2, 4, 8, 15 s), six times; after that it says so and waits for you to press play.
//   - It plays only while you are in a vehicle (setInVehicle): getting out stops the stream, getting back in resumes it if the radio was on. A hidden tab pauses it too.
//   - The volume is the "radio" channel of lib/audio/mixer.js (and the master). iOS ignores element.volume (the device volume rules there), which Settings says.
//   - What is playing comes from /api/radio/meta (the server reads the stream's own metadata) every 20 s, for stations that carry it.
//   - What it remembers on this device: on/off and the last station. Nothing is played until a person has pressed something.
import { useSyncExternalStore } from "react";
import { channel, subscribeMix } from "../audio/mixer.js";
import { cleanStations, playable, STATIONS_URL } from "./stations.js";
import { splitTitle } from "./icy.js";

let RETRY = [1000, 2000, 4000, 8000, 15000];
const KEY = "lifeinoau:radio", META_EVERY = 20_000, STALL_MS = 12_000;
const IDLE = Object.freeze({ on: false, paused: false, stationId: null, status: "off", stations: [], loaded: false, inVehicle: false, artist: "", track: "", error: "", attempt: 0 });
let st = IDLE, el = null, token = 0, retryT = null, metaT = null, stallT = null, started = false;
const subs = new Set();
const set = (p) => { st = { ...st, ...p }; for (const f of subs) f(); };
export const getRadio = () => st;
export const subscribeRadio = (f) => (subs.add(f), () => subs.delete(f));
export const useRadio = () => useSyncExternalStore(subscribeRadio, getRadio, () => IDLE);

const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: st.on, stationId: st.stationId })); } catch { /* not remembered */ } };
const station = (id = st.stationId) => st.stations.find((s) => s.id === id) ?? null;

function audioEl() {
  if (el || typeof document === "undefined") return el;
  el = new Audio(); el.preload = "none"; el.autoplay = false; el.setAttribute("playsinline", ""); el.crossOrigin = null;   // no crossOrigin: a plain <audio> plays any stream, CORS or not
  el.addEventListener("playing", () => { if (!live(el)) return; clearTimeout(stallT); set({ status: "playing", error: "", attempt: 0 }); });
  el.addEventListener("waiting", () => { if (!live(el)) return; set({ status: "buffering" }); armStall(); });
  el.addEventListener("stalled", () => { if (!live(el)) return; armStall(); });
  el.addEventListener("error", () => { if (!live(el)) return; reconnect("The stream stopped."); });
  el.addEventListener("ended", () => { if (!live(el)) return; reconnect("The stream ended."); });
  return el;
}
/** Is the element currently supposed to be streaming? (events from a stream we already tore down are ignored) */
const live = (e) => e === el && st.on && !st.paused && st.inVehicle && !!e.getAttribute("src");
const armStall = () => { clearTimeout(stallT); stallT = setTimeout(() => { if (st.status === "buffering" || st.status === "loading") reconnect("No sound from the station."); }, STALL_MS); };
const applyVolume = () => { if (el) el.volume = Math.max(0, Math.min(1, channel("radio"))); };

/** Stop and forget the current stream (this is what really closes the connection). */
function teardown() {
  token++; clearTimeout(retryT); clearTimeout(stallT); clearInterval(metaT); retryT = stallT = metaT = null;
  if (el) { try { el.pause(); } catch { /* not playing */ } el.removeAttribute("src"); try { el.load(); } catch { /* ok */ } }
  import("../sound.js").then((m) => m.duckMusic?.(false)).catch(() => {});
}
function startStream() {
  teardown();
  const s = station(), a = audioEl();
  if (!a) return;
  if (!st.on || st.paused || !st.inVehicle) { set({ status: st.on ? (st.paused ? "paused" : "idle") : "off" }); return; }
  if (!s) { set({ status: "nostation", artist: "", track: "" }); return; }
  const my = token; set({ status: "loading", artist: "", track: "", error: "" }); applyVolume(); a.src = s.url; armStall();
  const p = a.play(); p?.catch?.((e) => { if (my !== token) return; if (e?.name === "NotAllowedError") set({ status: "tap", error: "Tap play to start the radio." }); else if (e?.name !== "AbortError") reconnect("Could not start the stream."); });
  import("../sound.js").then((m) => { if (my === token) m.duckMusic?.(true); }).catch(() => {});   // the game's background song gives way to the radio
  if (s.meta === "icy") { pollMeta(my, s); metaT = setInterval(() => pollMeta(my, s), META_EVERY); }
}
function reconnect(why) {
  if (!st.on || st.paused || !st.inVehicle) return;
  const n = st.attempt;
  if (n >= RETRY.length) { teardown(); set({ status: "error", error: why + " Press play to try again.", attempt: 0 }); return; }
  const my = ++token; clearTimeout(stallT); clearInterval(metaT); if (el) { try { el.pause(); } catch { /* ok */ } el.removeAttribute("src"); try { el.load(); } catch { /* ok */ } }
  set({ status: "reconnecting", error: why, attempt: n + 1 }); retryT = setTimeout(() => { if (my === token && st.on && !st.paused && st.inVehicle) { const keep = st.attempt; startStream(); set({ attempt: keep }); } }, RETRY[n]);
}
async function pollMeta(my, s) {
  if (my !== token || (typeof document !== "undefined" && document.hidden)) return;
  try { const r = await fetch(`/api/radio/meta?id=${encodeURIComponent(s.id)}`, { cache: "no-store" }); if (!r.ok || my !== token) return; const j = await r.json(); if (my !== token) return; const t = splitTitle(j.title); set({ artist: t?.artist ?? "", track: t?.track ?? "" }); } catch { /* no track info: the station name still shows */ }
}

// ---- the API the panel uses ----
/** Load the station list (once) and the remembered choice. Safe to call often. */
export async function initRadio() {
  if (started || typeof window === "undefined") return; started = true;
  let mem = {}; try { mem = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { /* none */ }
  let list = []; try { const r = await fetch(STATIONS_URL, { cache: "no-cache" }); if (r.ok) list = cleanStations(await r.json()); } catch { /* offline: no stations */ }
  const probe = document.createElement("audio"), ok = list.filter((s) => playable(s, { protocol: location.protocol, canPlay: (t) => probe.canPlayType(t) }));
  const id = ok.some((s) => s.id === mem.stationId) ? mem.stationId : ok[0]?.id ?? null;
  set({ stations: ok, loaded: true, stationId: id, on: !!mem.on && !!id }); if (st.on) startStream();
  subscribeMix(applyVolume);
  document.addEventListener("visibilitychange", () => { if (document.hidden) { if (st.on && st.status !== "off") { teardown(); } } else startStream(); });
  window.addEventListener("pagehide", teardown);
}
export function setPower(on) { if (on && !st.stations.length) { set({ on: true, status: "nostation" }); save(); return; } set({ on: !!on, paused: false, attempt: 0 }); save(); startStream(); }
export function setPlaying(play) { set({ paused: !play, attempt: 0 }); startStream(); }
export function selectStation(id) { if (!station(id)) return; set({ stationId: id, on: true, paused: false, attempt: 0 }); save(); startStream(); }
/** Next (+1) or previous (-1) station, wrapping round. Switches on the radio if it is off. */
export function stepStation(d) { const l = st.stations; if (!l.length) return; const i = Math.max(0, l.findIndex((s) => s.id === st.stationId)); selectStation(l[(i + d + l.length) % l.length].id); }
/** The radio plays only while you are in a vehicle. */
export function setInVehicle(inV) { if (st.inVehicle === inV) return; set({ inVehicle: inV }); if (inV) startStream(); else { teardown(); set({ status: st.on ? "idle" : "off", artist: "", track: "" }); } }
/** For the tests: shorter reconnect delays. */
export const _setRetry = (a) => { RETRY = a; };
/** For the tests: forget everything. */
export function _resetRadio() { teardown(); st = IDLE; started = false; el = null; }
