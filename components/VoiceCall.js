// components/VoiceCall.js
// The screen of a live voice call with Mummy / Daddy (drawn inside the same handset as every other call, see CallLayer.js). Nothing here is read:
// she speaks out loud, the player talks, and this screen only shows who has the floor (waveform + status), the timer and the controls.
// The conversation itself lives in lib/voice/session.js; the store that owns it is parentCall in lib/callsClient.js.
"use client";
import { useEffect, useRef } from "react";
import { PhoneDisconnect, Microphone, MicrophoneSlash, SpeakerHigh, SpeakerLow, WifiSlash, SpeakerSimpleSlash } from "@phosphor-icons/react";
import { parentCall } from "@/lib/callsClient";
import * as pv from "@/lib/voice/playerVoice";
import { ERROR_TEXT } from "@/lib/voice/client";
import { naira } from "@/lib/client";
import "./voice-call.css";

const clock = (ms) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const STATUS = { connecting: "Connecting…", ringing: "Ringing…", connected: "Connected", thinking: "Connected", listening: "Listening", speaking: "Speaking", ended: "Call ended" };
const BARS = 27;

/** The voice animation: bars driven by the real loudness of whoever is talking (her voice from the speaker, the player's from the microphone). */
export function Wave({ ui }) {
  const cv = useRef(null), av = useRef(null), ref = useRef(ui);
  ref.current = ui;
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1), W = 260, H = 64;
    c.width = W * dpr; c.height = H * dpr; ctx.scale(dpr, dpr);
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const h = new Array(BARS).fill(2); let raf = 0, t0 = performance.now();
    const draw = (now) => {
      const u = ref.current, lv = u?.levels?.() ?? { you: 0, her: 0 }, st = u?.stateOf ? u.stateOf(lv) : u?.vstate, muted = u?.muted;
      const her = st === "speaking", you = st === "listening" && !muted;
      const amp = her ? Math.max(0.18, lv.her) : you ? lv.you : 0, color = her ? "#3fd08a" : "#7f8cff";
      const ph = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < BARS; i++) {
        const mid = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2) * 0.65; // taller in the middle
        const wob = calm ? 0.7 : 0.55 + 0.45 * Math.sin(ph * 7 + i * 0.9) * Math.sin(ph * 3.1 + i * 0.37);
        const target = 3 + amp * (H - 8) * mid * Math.abs(wob) * 1.6;
        h[i] += (Math.min(H - 4, target) - h[i]) * 0.32;
        const x = 2 + i * ((W - 4) / BARS), w = Math.max(3, (W - 4) / BARS - 4);
        ctx.fillStyle = amp > 0.02 ? color : "rgba(255,255,255,0.28)";
        ctx.beginPath(); ctx.roundRect(x, (H - h[i]) / 2, w, h[i], w / 2); ctx.fill();
      }
      if (av.current) av.current.style.setProperty("--lvl", her ? Math.min(1, lv.her * 1.4).toFixed(2) : "0");
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <><canvas ref={cv} className="vc-wave" style={{ width: 260, height: 64 }} aria-hidden="true" /><span ref={av} className="vc-lvl" aria-hidden="true" /></>;
}

export default function VoiceCall({ ui }) {
  const ended = ui.phase === "voice-ended", err = ui.verror, gift = BigInt(ui.result?.giftKobo ?? 0);
  const st = ended ? "ended" : ui.vstate ?? "connected";
  const status = ui.muted && !ended ? "Muted" : STATUS[st] ?? "Connected";
  const talking = ui.vend ? ui.vend - ui.vstart : ui.vstart ? Date.now() - ui.vstart : 0;

  if (ui.phase === "error") { // the microphone was refused or missing: nothing was dialled, so nothing was used up
    return (
      <section className="cx vc" role="alertdialog" aria-modal="true" aria-label="Call not started" data-tone="bad">
        <span className="cx-res" aria-hidden="true"><MicrophoneSlash size={32} weight="fill" /></span>
        <h2>Call not started</h2>
        <p className="cx-sub vc-why vc-bad" role="alert">{ERROR_TEXT[err] ?? ERROR_TEXT.service}</p>
        <p className="cx-sub">You have not used up a call.</p>
        <button type="button" className="cx-btn cx-wide cx-yes" onClick={() => parentCall.dismiss()} autoFocus>OK</button>
      </section>
    );
  }
  if (ended) {
    const why = err ? ERROR_TEXT[err] ?? ERROR_TEXT.service : ui.reason === "no-response" ? `${ui.name} could not hear you and hung up.` : ui.reason === "time-limit" ? `${ui.name} had to go.` : "";
    return (
      <section className="cx vc" role="dialog" aria-modal="true" aria-label="Call ended" data-tone={err ? "bad" : gift > 0n ? "ok" : undefined}>
        <span className="cx-av" aria-hidden="true">{String(ui.name).charAt(0).toUpperCase()}</span>
        <h2>{ui.name}</h2>
        <p className="cx-kind" aria-live="polite">Call ended{ui.vstart ? ` · ${clock(talking)}` : ""}</p>
        {why && <p className={`cx-sub vc-why${err ? " vc-bad" : ""}`} role={err ? "alert" : undefined}>{why}</p>}
        {gift > 0n && <p className="cx-sub vc-money">{ui.name} sent you {naira(gift)}. It is in your balance.</p>}
        <button type="button" className="cx-btn cx-wide cx-yes" onClick={() => parentCall.dismiss()} autoFocus>Done</button>
      </section>
    );
  }
  return (
    <section className="cx vc" role="dialog" aria-modal="true" aria-label={`Call with ${ui.name}`}>
      <span className="cx-av vc-av" data-who={st === "speaking" ? "her" : st === "listening" && !ui.muted ? "you" : ""} aria-hidden="true">{String(ui.name).charAt(0).toUpperCase()}</span>
      <h2>{ui.name}</h2>
      <p className={`cx-kind vc-status${st === "speaking" || st === "listening" ? " cx-live" : ""}`} aria-live="polite"><span className="cx-dot" aria-hidden="true" /> {status} · <b className="num">{clock(talking)}</b></p>
      <Wave ui={ui} />
      {ui.offline && <p className="cx-warn vc-note" role="alert"><WifiSlash size={16} weight="bold" aria-hidden="true" /> No connection. Trying to stay on the line…</p>}
      {ui.blocked && <button type="button" className="vc-sound" onClick={() => parentCall.retrySound()}><SpeakerHigh size={18} weight="fill" aria-hidden="true" /> Tap to hear {ui.name}</button>}
      <div className="vc-ctl">
        <button type="button" className="vc-b" aria-pressed={!!ui.muted} onClick={() => parentCall.setMuted(!ui.muted)} data-sound="none">
          <span>{ui.muted ? <MicrophoneSlash size={26} weight="fill" /> : <Microphone size={26} weight="fill" />}</span><small>{ui.muted ? "Unmute" : "Mute"}</small></button>
        <button type="button" className="vc-end" onClick={() => parentCall.hangUp()} aria-label="End call"><PhoneDisconnect size={28} weight="fill" /></button>
        <button type="button" className="vc-b" aria-pressed={!!ui.loud} onClick={() => parentCall.setLoud(!ui.loud)} data-sound="none">
          <span>{ui.loud ? <SpeakerHigh size={26} weight="fill" /> : <SpeakerLow size={26} weight="fill" />}</span><small>Speaker</small></button>
      </div>
    </section>
  );
}

const SAY = {
  idle: "Connecting audio…", connecting: "Connecting audio…", reconnecting: "Reconnecting audio…",
  failed: "The voice could not connect. Some networks block direct calls.",
  "no-mic": "Your microphone is blocked, so they cannot hear you.",
  offline: "Voice is not available right now (no live connection). You can still use the call to ask for money.",
};
const playerWave = { levels: pv.levels, stateOf: (lv) => (lv.her > 0.05 ? "speaking" : lv.you > 0.05 ? "listening" : "connected") };
/** The voice part of a call between two players (inside the money call screen of CallLayer): live waveform, who is talking, mute and speaker. */
export function PlayerVoicePanel({ peer }) {
  const v = pv.usePlayerVoice(), live = v.phase === "live" || v.phase === "reconnecting";
  const lv = live ? pv.levels() : { you: 0, her: 0 }, who = lv.her > 0.05 ? `${peer} is talking` : lv.you > 0.05 && !v.muted ? "You are talking" : v.muted ? "Muted" : "Connected";
  const bad = ["failed", "no-mic", "offline"].includes(v.phase);
  return (
    <div className="vc-panel" role="group" aria-label="Voice">
      {live ? <><Wave ui={{ ...playerWave, muted: v.muted }} /><p className="cx-sub" aria-live="polite">{v.phase === "reconnecting" ? SAY.reconnecting : who}</p></>
        : <p className={`cx-sub${bad ? " vc-bad" : ""}`} role={bad ? "alert" : undefined} aria-live="polite">{SAY[v.phase] ?? SAY.idle}</p>}
      {v.blocked && <button type="button" className="vc-sound" onClick={() => pv.retrySound()}><SpeakerHigh size={18} weight="fill" aria-hidden="true" /> Tap to hear {peer}</button>}
      {live && <div className="vc-ctl vc-ctl-sm">
        <button type="button" className="vc-b" aria-pressed={!!v.muted} onClick={() => pv.setMuted(!v.muted)} data-sound="none"><span>{v.muted ? <MicrophoneSlash size={22} weight="fill" /> : <Microphone size={22} weight="fill" />}</span><small>{v.muted ? "Unmute" : "Mute"}</small></button>
        <button type="button" className="vc-b" aria-pressed={!!v.loud} onClick={() => pv.setLoud(!v.loud)} data-sound="none"><span>{v.loud ? <SpeakerHigh size={22} weight="fill" /> : <SpeakerLow size={22} weight="fill" />}</span><small>Speaker</small></button>
      </div>}
    </div>
  );
}
