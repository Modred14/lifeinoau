// components/CarRadio.js
// The car radio: a round button with the other driving buttons, and a small panel that opens under the trip card (top left). The panel is kept compact so the road, the
// vehicle and the pedals stay clear: the station and what is playing, previous / play-pause / next, the volume, and a list of stations that opens when you want to browse.
// While it is playing and the panel is closed, a one-line chip under the trip card says what is on. Everything here is a real button (keyboard and screen reader friendly);
// on a keyboard: R opens/closes the panel, , and . change station. The radio plays only while `active` (you are in a vehicle); leaving it stops the stream.
// The sound itself is lib/radio/radio.js; the station list is public/data/radio-stations.json.
"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useRadio, initRadio, setPower, setPlaying, selectStation, stepStation, setInVehicle } from "@/lib/radio/radio.js";
import { useMix, setMix } from "@/lib/audio/mixer.js";
import "./car-radio.css";

/** What the panel says under the station name. */
export function radioLine(r) {
  if (!r.on) return "Radio off";
  if (!r.stations.length) return r.loaded ? "No stations available right now" : "Loading stations…";
  const track = [r.artist, r.track].filter(Boolean).join(" · ");
  switch (r.status) {
    case "loading": return "Connecting…";
    case "buffering": return "Buffering…";
    case "reconnecting": return `Reconnecting… (${Math.min(r.attempt, 5)}/5)`;
    case "error": return r.error || "Could not play this station";
    case "tap": return r.error || "Tap play to start";
    case "paused": return "Paused";
    case "playing": return track || [r.stations.find((s) => s.id === r.stationId)?.genre, r.stations.find((s) => s.id === r.stationId)?.country].filter(Boolean).join(" · ") || "On air";
    default: return "Ready";
  }
}

export default function CarRadio({ active, float = false }) {
  const r = useRadio(), mix = useMix(), [open, setOpen] = useState(false), [list, setList] = useState(false), panel = useRef(null), btn = useRef(null);
  const cur = r.stations.find((s) => s.id === r.stationId), busy = ["loading", "buffering", "reconnecting"].includes(r.status);
  useEffect(() => { initRadio(); }, []);
  useEffect(() => { setInVehicle(!!active); return () => setInVehicle(false); }, [active]);   // getting out (or leaving the trip) stops the stream
  useEffect(() => {
    if (!active) return;
    const k = (e) => { if (e.metaKey || e.ctrlKey || e.altKey || e.target?.closest?.("input,textarea,select")) return;
      if (e.code === "KeyR" && !e.repeat) setOpen((o) => !o); else if (e.key === "." && r.stations.length) stepStation(1); else if (e.key === "," && r.stations.length) stepStation(-1); else if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [active, r.stations.length]);
  useEffect(() => { if (!open) return; const away = (e) => { if (!panel.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); }; document.addEventListener("pointerdown", away); return () => document.removeEventListener("pointerdown", away); }, [open]);
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  if (!active) return null;
  const power = () => { setPower(!r.on); if (!r.on) setOpen(true); };
  return (
    <>
      <button ref={btn} type="button" className={"th-btn th-radio" + (float ? " th-radio-float" : "")} data-on={r.on ? "1" : undefined} aria-label={open ? "Close the car radio" : "Open the car radio"} aria-expanded={open} data-sound="none" onClick={() => setOpen((o) => !o)}>
        <Icon name="radio" size={22} weight={r.on ? "fill" : "regular"} />
      </button>
      {!open && r.on && r.stations.length > 0 && <button type="button" className="cr-chip" onClick={() => setOpen(true)} data-sound="none" aria-label={`Radio: ${cur?.name ?? ""}. ${radioLine(r)}. Open the radio`}><i className="cr-eq" data-busy={busy ? "1" : undefined} data-live={r.status === "playing" ? "1" : undefined} aria-hidden="true"><b /><b /><b /></i><span>{cur?.name}</span></button>}
      {open && (
        <div ref={panel} className="cr" role="dialog" aria-label="Car radio">
          <header>
            <button type="button" className="cr-pw" data-on={r.on ? "1" : undefined} aria-pressed={r.on} aria-label={r.on ? "Turn the radio off" : "Turn the radio on"} data-sound="none" onClick={power}><Icon name="power" size={18} weight="bold" /></button>
            <b>Car radio</b>
            <button type="button" className="cr-x ghost" aria-label="Close the radio" data-sound="none" onClick={() => setOpen(false)}><Icon name="close" size={18} /></button>
          </header>
          <div className="cr-screen" data-on={r.on ? "1" : undefined}>
            <i className="cr-eq" data-busy={busy ? "1" : undefined} data-live={r.status === "playing" ? "1" : undefined} aria-hidden="true"><b /><b /><b /><b /></i>
            <div className="cr-txt"><b>{r.on ? cur?.name ?? "No station" : "—"}</b><span role="status" aria-live="polite">{radioLine(r)}</span></div>
            {busy && <i className="cr-spin" aria-hidden="true" />}
          </div>
          <div className="cr-ctl">
            <button type="button" aria-label="Previous station" disabled={!r.stations.length} data-sound="none" onClick={() => stepStation(-1)}><Icon name="prevStation" size={20} weight="fill" /></button>
            <button type="button" className="cr-play" aria-label={r.on && !r.paused ? "Pause" : "Play"} disabled={!r.stations.length} data-sound="none" onClick={() => (r.on ? setPlaying(r.paused || r.status === "error" || r.status === "tap") : setPower(true))}><Icon name={r.on && !r.paused && r.status !== "error" && r.status !== "tap" ? "pause" : "play"} size={24} weight="fill" /></button>
            <button type="button" aria-label="Next station" disabled={!r.stations.length} data-sound="none" onClick={() => stepStation(1)}><Icon name="nextStation" size={20} weight="fill" /></button>
          </div>
          <div className="cr-vol">
            <Icon name={mix.radioVolume === 0 || mix.masterMute ? "mute" : "sound"} size={18} />
            <input type="range" min="0" max="100" step="5" value={mix.radioVolume} aria-label="Radio volume" onChange={(e) => setMix({ radioVolume: Number(e.target.value) })} aria-valuetext={`${mix.radioVolume} percent`} />
            <output className="num">{mix.radioVolume}%</output>
          </div>
          {mix.masterMute && <p className="cr-note">Everything is muted in Settings.</p>}
          {r.stations.length > 1 && <button type="button" className="cr-more ghost" aria-expanded={list} data-sound="none" onClick={() => setList((l) => !l)}>{list ? "Hide stations" : `Stations (${r.stations.length})`}</button>}
          {list && <ul className="cr-list" aria-label="Stations">{r.stations.map((s) => <li key={s.id}><button type="button" aria-current={s.id === r.stationId ? "true" : undefined} data-sound="none" onClick={() => { selectStation(s.id); }}><b>{s.name}</b><small>{[s.genre, s.country].filter(Boolean).join(" · ")}</small></button></li>)}</ul>}
          <p className="cr-key" aria-hidden="true"><kbd>R</kbd> radio <kbd>,</kbd><kbd>.</kbd> station</p>
        </div>
      )}
    </>
  );
}
