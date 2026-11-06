// lib/voice/session.js  (browser; every outside thing is injected, so tests/voice.test.mjs runs it with fakes)
// One live voice call with a parent. It owns the conversation: it listens to the player (streaming speech recognition, interim results while they talk),
// decides when they have finished a turn, streams the parent's reply sentence by sentence into the speaker, lets the player cut in at any moment,
// and never stays stuck: every wait has a timeout that ends in a visible state.
//
// states: connecting -> ringing -> connected -> (listening <-> thinking <-> speaking) -> ended
//   listening  the player has the floor (the mic is open; shows live words as they speak)
//   thinking   the player finished, the parent has not started speaking yet
//   speaking   the parent's voice is playing; the player can interrupt
//   muted is a flag, not a state: the mic is closed, the parent can still talk
import { VOICE_LIMITS, isEcho, endOfTurnMs } from "./persona.js";

export const SILENCE_PROMPT_MS = 20_000; // nobody spoke for this long while it was the player's turn: she checks in
export const SILENCE_HANGUP_AFTER = 2; // ... and after this many unanswered check-ins the call ends
export const THINK_TIMEOUT_MS = 14_000; // no first sentence from the AI in this time: one retry, then the call fails visibly
const MIN_BARGE_WORDS = 2;

export class VoiceSession {
  /**
   * deps: { callId, ask(args) -> async iterable of sentences, speaker, newRecognition() -> recognition | null, onState(s, info), onText({ you, her }),
   *         onError(code, message), onEnd(reason), now, setTimer, clearTimer }
   */
  constructor(deps) {
    Object.assign(this, { now: () => Date.now(), setTimer: (f, ms) => setTimeout(f, ms), clearTimer: (t) => clearTimeout(t) }, deps);
    this.state = "connecting"; this.muted = false; this.ended = false; this.history = [];
    this.heard = ""; this.interim = ""; this.turn = null; this.timers = {}; this.silences = 0; this.recFails = 0; this.startedAt = 0; this.rec = null; this.recOn = false; this.answering = false;
    this.speaker.onStart = (t) => { if (this.turn) this.turn.nowSaying = t; this._set("speaking"); this._emitText(); };
    this.speaker.onEnd = (t) => { if (this.turn) { this.turn.spoken.push(t); this.turn.nowSaying = ""; } this._emitText(); };
    this.speaker.onIdle = () => { if (this.turn?.done) this._turnFinished(); };
  }

  // ---------- lifecycle ----------
  /** The phone is picked up (the server already settled the call): she greets the player and the mic opens. */
  connect() {
    if (this.ended) return;
    this.startedAt = this.now();
    this._set("connected");
    this._arm("max", VOICE_LIMITS.maxCallMs, () => this._timeUp());
    this._listen();
    this._speakTurn({ event: "open" });
  }
  hangUp(reason = "hung-up") { this._finish(reason); }
  setMuted(m) {
    if (this.ended) return;
    this.muted = !!m;
    if (this.muted) { this._stopRec(); this.heard = this.interim = ""; this._clear("turn"); this._clear("silence"); }
    else { this._listen(); this._armSilence(); }
    this._set(this.state);
  }
  get duration() { return this.startedAt ? this.now() - this.startedAt : 0; }

  // ---------- state ----------
  _set(s) {
    if (this.ended && s !== "ended") return;
    this.state = s; this.onState?.(s, { muted: this.muted });
  }
  _idleState() { return this.muted ? "connected" : "listening"; }
  _emitText() { this.onText?.({ you: (this.heard + " " + this.interim).trim(), her: this.turn?.nowSaying ?? "" }); }
  _arm(k, ms, fn) { this._clear(k); this.timers[k] = this.setTimer(fn, ms); }
  _clear(k) { if (this.timers[k] != null) { this.clearTimer(this.timers[k]); delete this.timers[k]; } }
  _armSilence() { this._clear("silence"); if (this.ended || this.muted) return; this._arm("silence", SILENCE_PROMPT_MS, () => this._silent()); }

  // ---------- listening ----------
  _listen() {
    if (this.ended || this.muted || this.recOn) return;
    const rec = this.rec ?? (this.rec = this.newRecognition?.({ fallback: !!this.langFallback }));
    if (!rec) { this._fail("unsupported"); return; }
    rec.onresult = (e) => this._onResult(e);
    rec.onerror = (e) => this._onRecError(e);
    rec.onend = () => { this.recOn = false; if (!this.ended && !this.muted) this._arm("restart", 250, () => this._listen()); }; // browsers end recognition after silence: open it again
    try { rec.start(); this.recOn = true; } catch { this.recOn = true; /* already started */ }
  }
  _stopRec() { this._clear("restart"); if (this.rec) { try { this.rec.onend = null; this.rec.abort?.(); this.rec.stop?.(); } catch { /* already stopped */ } } this.recOn = false; }
  _onRecError(e) {
    const err = e?.error;
    if (err === "no-speech" || err === "aborted") return; // normal: the player has not said anything yet
    if (err === "language-not-supported" && !this.langFallback) { this.langFallback = true; this.rec = null; this.recOn = false; return this._listen(); } // this device cannot do Nigerian English: use plain English
    if (err === "not-allowed" || err === "service-not-allowed") return this._fail("mic-denied");
    if (err === "audio-capture") return this._fail("no-mic");
    if (++this.recFails > 4) return this._fail("network"); // network / language-not-supported ... keep trying a few times, then say so
    this._arm("restart", 400 * this.recFails, () => this._listen());
  }
  /** SpeechRecognitionEvent: results since resultIndex are new or changed. */
  _onResult(e) {
    if (this.ended || this.muted) return;
    this.recFails = 0;
    let finalText = "", interim = "";
    for (let i = e.resultIndex ?? 0; i < e.results.length; i++) { const r = e.results[i], t = r[0]?.transcript ?? ""; if (r.isFinal) finalText += t + " "; else interim += t; }
    const said = (finalText + interim).trim();
    if (!said) return;
    // her own voice leaking from the speaker into the mic is not the player talking
    if (this.speaker.busy && isEcho(said, this._herWords())) return;
    // the player talks over her: she stops at once
    if (this.speaker.busy || this.turn) {
      if (said.split(/\s+/).length < MIN_BARGE_WORDS && !finalText) return; // a single stray sound is not an interruption
      this._interrupt();
    }
    this._clear("silence"); this.silences = 0;
    if (finalText) this.heard = (this.heard + " " + finalText).trim();
    this.interim = interim.trim();
    if (this.state !== "listening") this._set("listening");
    this._emitText();
    this._arm("turn", endOfTurnMs((this.heard + " " + this.interim).trim()), () => this._commit());
  }
  _herWords() { return [...(this.turn?.spoken ?? []), this.turn?.nowSaying ?? "", ...(this.turn?.queued ?? [])].join(" "); }

  // ---------- the player's turn ends ----------
  _commit() {
    if (this.ended || this.muted) return;
    const text = (this.heard + " " + this.interim).trim(); this.heard = this.interim = "";
    if (!text) return;
    const last = this.history[this.history.length - 1];
    if (last?.role === "user") last.content = (last.content + " " + text).slice(-VOICE_LIMITS.maxChars); // two things said in a row are one message
    else this.history.push({ role: "user", content: text.slice(0, VOICE_LIMITS.maxChars) });
    this._emitText();
    this._speakTurn({ text: this.history[this.history.length - 1].content }); // the whole message (two things said in a row are sent together)
  }
  _silent() {
    if (this.ended || this.muted || this.turn || this.speaker.busy) return this._armSilence();
    if (++this.silences > SILENCE_HANGUP_AFTER) return this._finish("no-response");
    this._speakTurn({ event: "silence" });
  }
  _timeUp() { if (!this.ended) { this._speakTurn({ event: "goodbye", last: true }); this._arm("hardstop", 15_000, () => this._finish("time-limit")); } }

  // ---------- her turn ----------
  /** Asks the AI and speaks the answer as it streams in. A failed first attempt is retried once with the SAME history (nothing is said twice). */
  async _speakTurn({ text, event, last = false }, attempt = 0) {
    if (this.ended) return;
    this._interrupt(false);
    const turn = this.turn = { id: (this.turnId = (this.turnId ?? 0) + 1), spoken: [], queued: [], nowSaying: "", done: false, ctl: new AbortController(), got: 0, last };
    this._set("thinking"); this._clear("silence");
    const stall = () => { if (this.turn === turn && !turn.got) turn.ctl.abort("stalled"); };
    this._arm("think", THINK_TIMEOUT_MS, stall);
    try {
      const history = this.history.slice(0, text ? -1 : undefined); // the player's latest words are sent as `text`, not twice
      for await (const sentence of this.ask({ callId: this.callId, history, text, event, signal: turn.ctl.signal })) {
        if (this.turn !== turn || this.ended) return;
        turn.got++; this._clear("think"); turn.queued.push(sentence); this.speaker.enqueue(sentence);
      }
      if (this.turn !== turn || this.ended) return;
      this._clear("think");
      if (!turn.got) {
        if (turn.ctl.signal.aborted && attempt < 1) return this._speakTurn({ text, event, last }, attempt + 1); // stalled once: try again before giving up
        throw Object.assign(new Error("empty"), { code: "service" });
      }
      turn.done = true;
      if (!this.speaker.busy) this._turnFinished();
    } catch (e) {
      if (this.turn !== turn || this.ended) return;
      this._clear("think");
      if (attempt < 1 && e?.code !== "unavailable" && e?.code !== "mic-denied") return this._speakTurn({ text, event, last }, attempt + 1); // a dropped connection: reconnect once, same history
      this._fail(e?.code ?? "service", e?.message);
    }
  }
  /** She has said everything of this turn. */
  _turnFinished() {
    const turn = this.turn; if (!turn || this.ended) return;
    const said = turn.spoken.join(" ").trim();
    this._record(said);
    this.turn = null;
    if (turn.last) return this._finish("time-limit");
    this._set(this._idleState()); this._emitText();
    this._armSilence();
  }
  /** The player cut in (or a new turn begins): cancel her voice and the AI request, and remember only what she actually got to say. */
  _interrupt(setListening = true) {
    const turn = this.turn;
    if (turn) {
      turn.ctl.abort("interrupted"); this.speaker.cancel();
      const said = [...turn.spoken, turn.nowSaying].filter(Boolean).join(" ").trim();
      this._record(said ? said + (turn.done && !turn.nowSaying ? "" : " —") : ""); // an em dash marks "cut off" for the model
      this.turn = null;
    }
    this._clear("think");
    if (setListening && !this.ended) this._set(this._idleState());
  }
  _record(said) {
    if (!said) return;
    const last = this.history[this.history.length - 1];
    if (last?.role === "assistant") last.content = (last.content + " " + said).slice(-VOICE_LIMITS.maxChars);
    else this.history.push({ role: "assistant", content: said.slice(0, VOICE_LIMITS.maxChars) });
  }

  // ---------- the end ----------
  _fail(code, message) {
    if (this.ended) return;
    this.onError?.(code, message);
    this._finish("error:" + code);
  }
  _finish(reason) {
    if (this.ended) return;
    this._interrupt(false);
    this.ended = true; // set after _interrupt so the speaker is silenced first
    for (const k of Object.keys(this.timers)) this._clear(k);
    this._stopRec();
    try { this.speaker.destroy(); } catch { /* already gone */ }
    this.state = "ended"; this.onState?.("ended", { muted: this.muted, reason });
    this.onEnd?.(reason);
  }
}
