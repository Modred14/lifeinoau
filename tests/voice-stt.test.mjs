// tests/voice-stt.test.mjs: the server-side ears of the voice call (lib/voice/client.js ServerRecognition, provider transcribe, session fallback).
// Fake microphone loudness, fake MediaRecorder, fake network. It proves the rules (when an utterance starts/ends, what is sent, what is dropped, when the session
// switches to the server's ears). It does NOT prove a real microphone or a real speech model: see docs/VOICE-CALLS.md "Checking it by hand".
import assert from "node:assert/strict";
import { voiceConfig, publicStatus, transcribe, VoiceError } from "../lib/voice/provider.js";
import { ServerRecognition } from "../lib/voice/client.js";
import { VoiceSession, DEAF_AFTER_MS } from "../lib/voice/session.js";

const tick = () => new Promise((r) => setImmediate(r));
const env = { VOICE_LLM_API_KEY: "k", VOICE_LLM_BASE_URL: "https://x.test/v1", VOICE_LLM_MODEL: "m" };

// ---------- config + provider ----------
assert.equal(publicStatus(voiceConfig(env)).stt, null, "no STT model = no server ears");
assert.equal(publicStatus(voiceConfig({ ...env, VOICE_STT_MODEL: "whisper" })).stt, "server");
assert.equal(publicStatus(voiceConfig({ VOICE_STT_MODEL: "whisper" })).stt, null, "STT never advertised without the AI configured");
assert.equal(voiceConfig({ ...env, VOICE_STT_MODEL: "w", VOICE_STT_BASE_URL: "https://s.test/v1/", VOICE_STT_API_KEY: "sk" }).sttBase, "https://s.test/v1");
assert.ok(!JSON.stringify(publicStatus(voiceConfig({ ...env, VOICE_STT_MODEL: "w", VOICE_STT_API_KEY: "sk-secret" }))).includes("secret"));
{
  const cfg = voiceConfig({ ...env, VOICE_STT_MODEL: "whisper-x" }); let seen;
  const f = async (url, init) => { seen = { url, init }; return Response.json({ text: "  I need money for books  " }); };
  const text = await transcribe(new Blob([new Uint8Array(2000)], { type: "audio/webm" }), { cfg, fetchImpl: f });
  assert.equal(text, "I need money for books"); assert.equal(seen.url, "https://x.test/v1/audio/transcriptions");
  assert.equal(seen.init.headers.authorization, "Bearer k"); assert.equal(seen.init.body.get("model"), "whisper-x"); assert.ok(seen.init.body.get("file"));
  await assert.rejects(() => transcribe(new Blob(["x"]), { cfg: voiceConfig(env) }), (e) => e instanceof VoiceError && e.status === 503);
  await assert.rejects(() => transcribe(new Blob(["x"]), { cfg, fetchImpl: async () => new Response("no", { status: 429 }) }), (e) => e.status === 429);
  await assert.rejects(() => transcribe(new Blob(["x"]), { cfg, fetchImpl: async () => { throw new TypeError("offline"); } }), (e) => e instanceof VoiceError);
  assert.equal(await transcribe(new Blob(["x"]), { cfg, fetchImpl: async () => Response.json({}) }), "", "nothing recognised is an empty string, not an error");
}

// ---------- ServerRecognition ----------
function ears({ her = false, status = 200, body = { text: "Hello mummy" } } = {}) {
  let level = 0; const calls = []; const events = { results: [], errors: [], ended: 0 }; const recorders = [];
  class Rec { constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; recorders.push(this); } start() { this.state = "recording"; this.ondataavailable?.({ data: new Blob([new Uint8Array(1500)]) }); }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(600)]) }); this.onstop?.(); } static isTypeSupported(m) { return m === "audio/webm;codecs=opus"; } }
  const ctx = { createMediaStreamSource: () => ({ connect() {}, disconnect() {} }), createAnalyser: () => ({ fftSize: 0, getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128 + (i % 2 ? 1 : -1) * Math.round(level * 128); } }) };
  const r = new ServerRecognition({ stream: {}, ctx, callId: "call_12345678", Recorder: Rec, isHerTalking: () => her,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); } });
  r.onresult = (e) => events.results.push(e.results[0][0].transcript + (e.results[0].isFinal ? "|final" : "")); r.onerror = (e) => events.errors.push(e.error); r.onend = () => events.ended++;
  r.start(); clearInterval(r.timer); // ticks are driven by hand
  const run = async (lv, ms) => { level = lv; for (let t = 0; t < ms; t += 50) r._tick(); await tick(); await tick(); };
  return { r, run, calls, events, recorders };
}
{
  const e = ears(); await e.run(0, 300); assert.equal(e.calls.length, 0, "silence sends nothing");
  await e.run(0.2, 400); assert.equal(e.calls.length, 0, "still talking: nothing is sent yet");
  await e.run(0, 800); await tick();
  assert.equal(e.calls.length, 1, "one utterance = one request after the pause");
  assert.equal(e.calls[0].url, "/api/voice/transcribe?callId=call_12345678"); assert.equal(e.calls[0].init.headers["content-type"], "audio/webm"); assert.ok(e.calls[0].init.body.size >= 800);
  assert.deepEqual(e.events.results, ["Hello mummy|final"]);
  assert.equal(e.recorders.length, 2, "a new recording starts straight away for the next utterance");
  e.r.abort(); assert.equal(e.events.ended, 1); e.r.abort(); assert.equal(e.events.ended, 1, "abort twice is safe");
  e.r.start(); assert.ok(e.r.on, "it can be started again (mute then unmute)"); e.r.abort();
}
{ const e = ears(); await e.run(0, 5300); assert.equal(e.calls.length, 0, "5 s of silence never goes to the server"); assert.ok(e.recorders.length >= 2, "the recording restarts instead of growing"); e.r.abort(); }
{ const e = ears({ her: true }); await e.run(0.07, 600); await e.run(0, 900); assert.equal(e.calls.length, 0, "while she talks, a quiet sound (her own echo) is not the player"); e.r.abort(); }
{ const e = ears({ her: true }); await e.run(0.4, 500); await e.run(0, 900); assert.equal(e.calls.length, 1, "while she talks, a clearly loud voice is the player cutting in"); e.r.abort(); }
{ const e = ears({ body: { text: "you" } }); await e.run(0.2, 400); await e.run(0, 900); assert.equal(e.calls.length, 1); assert.deepEqual(e.events.results, [], "a typical silence hallucination is dropped"); e.r.abort(); }
{ const e = ears({ status: 502, body: { error: "x" } }); await e.run(0.2, 400); await e.run(0, 900); assert.deepEqual(e.events.errors, ["network"], "a failed request is reported, never turned into a fake transcript"); assert.deepEqual(e.events.results, []); e.r.abort(); }
{ const e = ears(); await e.run(0.2, 400); await e.run(0, 600); e.r.abort(); await e.run(0, 100); assert.deepEqual(e.events.results, [], "hanging up / muting mid-utterance sends and shows nothing"); }
{ const bad = new ServerRecognition({ stream: null, ctx: {}, callId: "c", Recorder: undefined }); const errs = []; bad.onerror = (x) => errs.push(x.error); bad.start(); assert.deepEqual(errs, ["audio-capture"], "no recorder: said out loud"); }

// ---------- the session switches to the server's ears ----------
function rig({ fallback = true, micLevel } = {}) {
  let t = 0, id = 0; const timers = new Map(); const log = { errors: [], ended: null, asks: [] };
  const speaker = { busy: false, enqueue() {}, cancel() {}, destroy() {} };
  const mk = (name) => ({ name, started: 0, stopped: 0, start() { this.started++; }, stop() { this.stopped++; }, abort() { this.stopped++; } });
  const first = mk("native"), second = mk("server"); let made = 0;
  const session = new VoiceSession({ callId: "call_12345678", speaker, newRecognition: () => first, newFallbackRecognition: fallback ? () => (made++, second) : null, micLevel,
    ask: async function* (a) { log.asks.push(a); yield "Hello my dear."; }, onState() {}, onError: (c) => log.errors.push(c), onEnd: (r) => (log.ended = r),
    now: () => t, setTimer: (f, ms) => { const k = ++id; timers.set(k, { f, at: t + ms }); return k; }, clearTimer: (k) => timers.delete(k) });
  const advance = async (ms) => { const to = t + ms; for (;;) { const due = [...timers].filter(([, v]) => v.at <= to).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; t = Math.max(t, due[1].at); timers.delete(due[0]); due[1].f(); await tick(); } t = to; };
  return { session, first, second, log, advance, made: () => made };
}
{ // the browser's engine cannot reach its service: first network error retries, the second hands over
  const r = rig(); r.session.connect(); await tick(); assert.equal(r.first.started, 1);
  r.first.onerror({ error: "network" }); await r.advance(600); assert.equal(r.second.started, 0, "one network blip is retried on the same engine");
  r.first.onerror({ error: "network" }); await tick(); assert.equal(r.second.started, 1, "a second one switches to the server's ears"); assert.equal(r.made(), 1); assert.equal(r.log.ended, null, "the call goes on");
  r.second.onerror({ error: "network" }); r.second.onerror({ error: "network" }); r.second.onerror({ error: "network" }); r.second.onerror({ error: "network" }); r.second.onerror({ error: "network" });
  assert.deepEqual(r.log.errors, ["network"], "if the server ears also fail, the call ends and says so (no fake transcript)"); r.session.hangUp();
}
{ const r = rig(); r.session.connect(); await tick(); r.first.onerror({ error: "service-not-allowed" }); await tick(); assert.equal(r.second.started, 1, "a blocked speech service switches at once instead of saying the microphone is blocked"); assert.deepEqual(r.log.errors, []); r.session.hangUp(); }
{ const r = rig({ fallback: false }); r.session.connect(); await tick(); r.first.onerror({ error: "service-not-allowed" }); assert.deepEqual(r.log.errors, ["mic-denied"], "without server ears the old behaviour is kept"); }
{ // the engine starts but never produces a word while the microphone is clearly loud
  let level = 0.4; const r = rig({ micLevel: () => level }); r.session.connect(); await tick();
  await r.advance(DEAF_AFTER_MS + 2000); assert.equal(r.second.started, 1, "the player is clearly talking and nothing is recognised: the server's ears take over"); r.session.hangUp();
}
{ // a quiet room never triggers it
  const r = rig({ micLevel: () => 0.01 }); r.session.connect(); await tick(); await r.advance(DEAF_AFTER_MS * 3); assert.equal(r.second.started, 0); r.session.hangUp();
}
console.log("voice stt tests passed");
