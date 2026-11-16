// lib/voice/client.js  (browser only)
// The phone's side of talking to /api/voice/*: is voice set up, the microphone, and streaming the parent's reply sentence by sentence.

export class VoiceFail extends Error { constructor(code, message) { super(message ?? code); this.code = code; } }

export const ERROR_TEXT = {
  "mic-denied": "Microphone access is blocked. Allow it for this site in your browser settings, then call again.",
  "no-mic": "No microphone was found on this device.",
  "mic-busy": "Your microphone is being used by another app.",
  unsupported: "This browser cannot do voice calls. Use Chrome, Edge or Safari.",
  network: "The connection dropped. Check your internet and call again.",
  service: "The line is too bad right now. Try again in a moment.",
  unavailable: "Voice calls are not available right now.",
};

export const recognitionClass = () => (typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

let statusAt = 0, statusVal = null;
/** { available, speech } from the server, cached for a minute. Never throws: a failure means "not available". */
export async function voiceStatus(force = false) {
  if (!force && statusVal && Date.now() - statusAt < 60_000) return statusVal;
  try {
    const r = await fetch("/api/voice/status", { cache: "no-store" });
    statusVal = r.ok ? await r.json() : { available: false, speech: null };
    statusAt = r.ok ? Date.now() : Date.now() - 55_000;
  } catch { statusVal = { available: false, speech: null }; statusAt = Date.now() - 55_000; } // a failed request is only remembered for 5 s, never a minute
  return statusVal;
}
/** The last known status without waiting (so the tap that starts a call can unlock audio synchronously). null until voiceStatus() has answered once. */
export const peekVoiceStatus = () => statusVal;
/** Can this browser hold a voice call? It needs a microphone and some way to understand speech: the built-in engine, or recording for the server's (status.stt). */
export const voiceSupported = (status = statusVal) => !!(typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia && (recognitionClass() || (status?.stt && typeof MediaRecorder !== "undefined")));
/** Why a call cannot be live, for the player: "unavailable" (not set up on the server) | "unsupported" (this browser) | null (it can). */
export const voiceBlocker = (status = statusVal) => (!status?.available ? "unavailable" : voiceSupported(status) ? null : "unsupported");

/**
 * Asks for the microphone and wakes the audio system. MUST run inside the tap that starts the call (that is what lets the browser play her voice
 * later). Returns { stream, ctx }. Throws a VoiceFail with a code from ERROR_TEXT.
 */
export async function prepareMic() {
  if (!voiceSupported()) throw new VoiceFail("unsupported");
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) {
    const n = e?.name;
    throw new VoiceFail(n === "NotAllowedError" || n === "SecurityError" ? "mic-denied" : n === "NotFoundError" || n === "OverconstrainedError" ? "no-mic" : n === "NotReadableError" || n === "AbortError" ? "mic-busy" : "no-mic");
  }
  let ctx = null;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume?.(); } catch { ctx = null; }
  return { stream, ctx };
}
export const stopMic = (stream) => { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ } };

/**
 * One turn with the parent. Yields her reply one whole sentence at a time as the AI writes it.
 * `event`: "open" (she picks up), "silence" (the player went quiet), "goodbye"; otherwise `text` is what the player said. Throws a VoiceFail on failure.
 */
export async function* askParent({ callId, history, text, event, signal, fetchImpl = (...a) => fetch(...a) }) {
  let res;
  try { res = await fetchImpl("/api/voice/parent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callId, history, text, event }), signal }); }
  catch (e) { if (e?.name === "AbortError") return; throw new VoiceFail("network"); }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new VoiceFail(res.status === 503 ? "unavailable" : res.status === 401 ? "service" : "service", j.error);
  }
  const dec = new TextDecoder(); let buf = "";
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!raw) continue;
        let m; try { m = JSON.parse(raw); } catch { continue; }
        if (m.s) yield m.s;
        else if (m.error) throw new VoiceFail(m.status === 503 ? "unavailable" : "service", m.error);
        else if (m.done) return;
      }
    }
  } catch (e) {
    if (e?.name === "AbortError") return;
    if (e instanceof VoiceFail) throw e;
    throw new VoiceFail("network");
  }
}

/** A 0..1 meter of the player's own voice (for the animation only). Returns { level(), close() }. Never throws. */
export function micMeter(ctx, stream) {
  try {
    const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an); // not connected to the speakers: no echo
    const a = new Uint8Array(an.fftSize);
    return { level() { an.getByteTimeDomainData(a); let t = 0; for (const x of a) { const d = (x - 128) / 128; t += d * d; } return Math.min(1, Math.sqrt(t / a.length) * 5); }, close() { try { src.disconnect(); } catch { /* gone */ } } };
  } catch { return { level: () => 0, close() {} }; }
}

// Speech recognition the SERVER does (VOICE_STT_*): records the player's utterances with MediaRecorder, finds where each one starts and ends from the loudness of the
// microphone, and sends each to /api/voice/transcribe. It looks like the browser's SpeechRecognition (start/stop/abort, onresult/onerror/onend) so the call session
// does not care which one it has. It uses the microphone stream the call already opened: it never opens a second one.
const HALLUCINATIONS = /^(thanks? for watching[.!]?|you[.!]?|\.+)$/i; // what speech models "hear" in near-silence
export class ServerRecognition {
  constructor({ stream, ctx, callId, isHerTalking = () => false, fetchImpl = (...a) => fetch(...a), Recorder = globalThis.MediaRecorder, tickMs = 50, now = () => Date.now() }) {
    Object.assign(this, { stream, ctx, callId, isHerTalking, fetchImpl, Recorder, tickMs, now });
    this.on = false; this.rec = null; this.chunks = []; this.timer = 0; this.an = null; this.src = null; this.gen = 0; this.pending = new Set();
    this.onresult = this.onerror = this.onend = null; this.speechMs = 0; this.quietMs = 0; this.segMs = 0; this.heard = false;
  }
  static mime(R = globalThis.MediaRecorder) { return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => R?.isTypeSupported?.(m)) ?? ""; }
  start() {
    if (this.on) return;
    if (!this.Recorder || !this.stream) { this.onerror?.({ error: "audio-capture" }); return; }
    try { this.src = this.ctx.createMediaStreamSource(this.stream); this.an = this.ctx.createAnalyser(); this.an.fftSize = 1024; this.src.connect(this.an); this.buf = new Uint8Array(this.an.fftSize); }
    catch { this.onerror?.({ error: "audio-capture" }); return; }
    this.on = true; this._segment(); this.timer = setInterval(() => this._tick(), this.tickMs);
  }
  stop() { this.abort(); }
  abort() {
    if (!this.on) return;
    this.on = false; this.gen++; clearInterval(this.timer); this.timer = 0;
    for (const c of this.pending) c.abort(); this.pending.clear();
    const r = this.rec; this.rec = null; this.chunks = [];
    if (r) { r.ondataavailable = null; r.onstop = null; try { if (r.state !== "inactive") r.stop(); } catch { /* already stopped */ } }
    try { this.src?.disconnect(); } catch { /* gone */ } this.src = this.an = null;
    this.onend?.();
  }
  _level() { this.an.getByteTimeDomainData(this.buf); let t = 0; for (const x of this.buf) { const d = (x - 128) / 128; t += d * d; } return Math.sqrt(t / this.buf.length); }
  _segment() { // one recording per utterance; it starts BEFORE the player speaks so the first word is never clipped
    const mime = ServerRecognition.mime(this.Recorder); this.chunks = []; this.speechMs = this.quietMs = this.segMs = 0; this.heard = false;
    try { this.rec = new this.Recorder(this.stream, mime ? { mimeType: mime } : undefined); } catch { this.rec = null; this.onerror?.({ error: "audio-capture" }); return; }
    const mine = this.rec; mine.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); }; mine.start(200);
  }
  _tick() {
    if (!this.on || !this.rec) return;
    const lv = this._level(), her = this.isHerTalking(), th = her ? 0.16 : 0.025; // while she talks only a clearly louder voice counts (the player cutting in), not her own echo
    this.segMs += this.tickMs;
    if (lv > th) { this.speechMs += this.tickMs; this.quietMs = 0; if (this.speechMs >= (her ? 300 : 150)) this.heard = true; } else this.quietMs += this.tickMs;
    if (this.heard && this.quietMs >= 750) return this._cut(true);
    if (this.heard && this.segMs > 20_000) return this._cut(true); // never an endless recording
    if (!this.heard && this.segMs > 5_000) this._cut(false); // nothing but silence: start over so the recording does not grow
  }
  _cut(send) {
    const r = this.rec, gen = this.gen; if (!r) return;
    this.rec = null; r.ondataavailable = null;
    const type = r.mimeType || ServerRecognition.mime(this.Recorder) || "audio/webm", got = this.chunks; this.chunks = [];
    r.onstop = () => { if (send && gen === this.gen) this._send(new Blob(got, { type })); };
    r.ondataavailable = (e) => { if (e.data?.size) got.push(e.data); }; // the last piece arrives with stop()
    try { r.stop(); } catch { /* already stopped */ }
    if (this.on) this._segment();
  }
  async _send(blob) {
    if (blob.size < 800) return;
    const ctl = new AbortController(); this.pending.add(ctl);
    try {
      const res = await this.fetchImpl(`/api/voice/transcribe?callId=${encodeURIComponent(this.callId)}`, { method: "POST", headers: { "content-type": (blob.type || "audio/webm").split(";")[0] }, body: blob, signal: ctl.signal });
      if (!res.ok) { this.onerror?.({ error: "network" }); return; }
      const text = String((await res.json().catch(() => ({}))).text ?? "").trim();
      if (!this.on || !text || HALLUCINATIONS.test(text)) return;
      this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    } catch (e) { if (e?.name !== "AbortError") this.onerror?.({ error: "network" }); }
    finally { this.pending.delete(ctl); }
  }
}

/** The browser's own recognition object (continuous, words as they are spoken), or null when this browser has none. */
export function newRecognition({ fallback = false } = {}) {
  const R = recognitionClass(); if (!R) return null;
  const rec = new R(); rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  rec.lang = fallback ? "en-US" : "en-NG"; // Nigerian English first: it understands the accent and local words better
  return rec;
}
