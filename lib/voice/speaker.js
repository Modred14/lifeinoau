// lib/voice/speaker.js  (browser only)
// What makes the parent's voice come out of the player's speaker or headphones. Two ways, chosen by the server's /api/voice/status:
//   "server"  a streaming text-to-speech provider (VOICE_TTS_*): each sentence is fetched as soon as the AI writes it and played in order.
//   "browser" the device's own speech synthesis. Free, no key, and works everywhere, but the voice quality depends on the device.
// Both speak sentence by sentence, can be cut off instantly (the player interrupts), and report what they are doing so the call screen and the
// conversation memory are always honest about what was really said out loud.

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

const FEMALE = /female|woman|zira|samantha|aria|jenny|sonia|natasha|libby|susan|hazel|karen|moira|tessa|fiona|catherine|serena|google uk english female|google us english|joanna|salli|kendra|emma|olivia|amy|sara/i;
const MALE = /\bmale\b|david|mark|daniel|george|guy|ryan|brian|alex|fred|oliver|thomas|google uk english male|james|arthur|aaron/i;
/** The best installed voice for a parent (pure, so it can be tested). Prefers English; Nigerian English, then British, then any English; then by gender name. */
export function pickVoice(voices, gender = "f", lang = "en-NG") {
  const list = (voices ?? []).filter((v) => /^en/i.test(v.lang ?? ""));
  if (!list.length) return null;
  const want = gender === "m" ? MALE : FEMALE, avoid = gender === "m" ? FEMALE : MALE;
  const score = (v) => {
    let s = 0;
    if (want.test(v.name)) s += 20;
    if (avoid.test(v.name)) s -= 30;
    if ((v.lang ?? "").toLowerCase().replace("_", "-") === lang.toLowerCase()) s += 8;
    else if (/en-(ng|gb|za|ke|gh)/i.test(v.lang ?? "")) s += 5;
    if (/natural|neural|online|enhanced|premium/i.test(v.name)) s += 6; // the better-sounding voices say so in their name
    if (v.localService === false) s += 1;
    return s;
  };
  return [...list].sort((a, b) => score(b) - score(a))[0];
}

export class Speaker {
  /**
   * mode: "server" | "browser". callId is needed only for "server". Callbacks: onStart(text) a sentence began, onEnd(text) it finished, onIdle() the queue
   * ran dry, onBlocked() the browser refuses to play sound until the player taps, onBoundary() a word was spoken (drives the voice animation).
   */
  constructor({ mode = "browser", callId = "", gender = "f", lang = "en-NG", ctx = null, fetchImpl = (...a) => fetch(...a), onStart, onEnd, onIdle, onBlocked, onBoundary } = {}) {
    Object.assign(this, { mode, callId, gender, lang, ctx, fetchImpl, onStart, onEnd, onIdle, onBlocked, onBoundary });
    this.queue = []; this.current = null; this.volume = 1; this.dead = false; this.pulse = 0; this.gen = 0;
    this.audio = null; this.analyser = null; this.blocked = false;
  }
  /** Call from the tap that starts the call: browsers only allow sound that follows a tap, and this unlocks both kinds of speech for the rest of the call. */
  prime() {
    try { this.audio = new Audio(); this.audio.src = SILENT_WAV; this.audio.play?.().catch(() => {}); } catch { /* no Audio element: the browser voice still works */ }
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch { /* no speech synthesis */ }
  }
  /** A real level meter for the server voice (the browser voice animates from its word events instead). Needs the AudioContext made at the start of the call. */
  attachMeter(ctx) {
    if (!ctx || !this.audio || this.analyser) return;
    try { const src = ctx.createMediaElementSource(this.audio); this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512; src.connect(this.analyser); this.analyser.connect(ctx.destination); } catch { this.analyser = null; }
  }
  setVolume(v) { this.volume = v; if (this.audio) this.audio.volume = v; }
  /** 0..1: how loud the parent is right now. */
  level() {
    if (this.analyser && this.current?.kind === "server") {
      const a = new Uint8Array(this.analyser.fftSize); this.analyser.getByteTimeDomainData(a);
      let s = 0; for (const x of a) { const d = (x - 128) / 128; s += d * d; } return Math.min(1, Math.sqrt(s / a.length) * 4);
    }
    this.pulse *= 0.86; // browser voice: each spoken word pulses the animation, then it fades
    return this.pulse;
  }
  get speaking() { return !!this.current; }
  get busy() { return !!this.current || this.queue.length > 0; }
  enqueue(text) {
    if (this.dead || !text) return;
    const item = { text, gen: this.gen };
    if (this.mode === "server") { item.ctl = new AbortController(); item.blob = this._fetch(item); item.blob.catch(() => {}); }
    this.queue.push(item); this._next();
  }
  cancel() {
    this.gen++; // anything still on its way is now stale
    for (const i of [...this.queue, this.current].filter(Boolean)) i.ctl?.abort();
    this.queue = []; this.current = null;
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    try { this.audio?.pause(); } catch { /* ignore */ }
  }
  destroy() { this.dead = true; this.cancel(); try { if (this.audio) { this.audio.src = ""; } } catch { /* ignore */ } }
  /** The player tapped "turn sound on": try again. */
  retry() { this.blocked = false; this.prime(); try { speechSynthesis.resume(); } catch { /* ignore */ } const c = this.current; if (c) { this.current = null; this.queue.unshift(c); } this._next(); }

  async _fetch(item) {
    const r = await this.fetchImpl("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callId: this.callId, text: item.text }), signal: item.ctl.signal });
    if (!r.ok) throw new Error("tts " + r.status);
    return URL.createObjectURL(await r.blob());
  }
  _next() {
    if (this.current || this.dead || this.blocked) return;
    const item = this.queue.shift();
    if (!item) return;
    this.current = item;
    const done = () => {
      if (this.current !== item) return;
      this.current = null; this.onEnd?.(item.text);
      if (this.queue.length) this._next(); else this.onIdle?.();
    };
    if (this.mode === "server") this._playServer(item, done).catch(() => this._playBrowser(item, done)); // if the server voice fails, this sentence is still spoken
    else this._playBrowser(item, done);
  }
  async _playServer(item, done) {
    item.kind = "server";
    const url = await item.blob;
    if (this.current !== item) { URL.revokeObjectURL(url); return; }
    const a = this.audio ?? (this.audio = new Audio());
    a.volume = this.volume; a.src = url;
    a.onended = () => { URL.revokeObjectURL(url); done(); };
    a.onerror = () => { URL.revokeObjectURL(url); if (this.current === item) done(); };
    try { await a.play(); this.onStart?.(item.text); }
    catch (e) {
      URL.revokeObjectURL(url);
      if (e?.name === "NotAllowedError") { this.blocked = true; this.queue.unshift(item); this.current = null; this.onBlocked?.(); return; }
      throw e;
    }
  }
  _playBrowser(item, done) {
    item.kind = "browser";
    if (typeof speechSynthesis === "undefined") { this.onStart?.(item.text); setTimeout(done, 0); return; }
    const u = new SpeechSynthesisUtterance(item.text);
    const v = pickVoice(speechSynthesis.getVoices(), this.gender, this.lang);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = this.lang;
    u.rate = this.gender === "m" ? 0.96 : 0.97; u.pitch = this.gender === "m" ? 0.85 : 1.02; u.volume = this.volume;
    let started = false;
    const guard = setTimeout(() => { if (!started && this.current === item && !speechSynthesis.speaking) { this.blocked = true; this.queue.unshift(item); this.current = null; this.onBlocked?.(); } }, 3500);
    u.onstart = () => { started = true; clearTimeout(guard); this.onStart?.(item.text); };
    u.onboundary = () => { this.pulse = 0.55 + Math.random() * 0.4; this.onBoundary?.(); };
    u.onend = () => { clearTimeout(guard); done(); };
    u.onerror = (e) => {
      clearTimeout(guard);
      if (e?.error === "canceled" || e?.error === "interrupted") return;
      if (e?.error === "not-allowed") { this.blocked = true; this.queue.unshift(item); this.current = null; this.onBlocked?.(); return; }
      done();
    };
    speechSynthesis.speak(u);
  }
}
