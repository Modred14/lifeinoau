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
  } catch { statusVal = { available: false, speech: null }; }
  statusAt = Date.now();
  return statusVal;
}
/** The last known status without waiting (so the tap that starts a call can unlock audio synchronously). null until voiceStatus() has answered once. */
export const peekVoiceStatus = () => statusVal;
export const voiceSupported = () => !!(recognitionClass() && typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia);

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

/** The recognition object for the session: continuous, with words as they are spoken. */
export function newRecognition({ fallback = false } = {}) {
  const R = recognitionClass(); if (!R) return null;
  const rec = new R(); rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  rec.lang = fallback ? "en-US" : "en-NG"; // Nigerian English first: it understands the accent and local words better
  return rec;
}
