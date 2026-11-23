// components/CarRadio.js
// The car radio: a round button with the other driving buttons, and a small panel that opens under the trip card (top left). The panel is kept compact so the road, the
// vehicle and the pedals stay clear: the station (name and logo) and what is playing, previous / play-pause / next, and a list of Nigerian stations, grouped by region, that opens when you want to browse. There is no volume control: the radio plays at a fixed level.
// While it is playing and the panel is closed, a one-line chip under the trip card says what is on. Everything here is a real button (keyboard and screen reader friendly);
// on a keyboard: R opens/closes the panel, , and . change station. The radio plays only while `active` (you are in a vehicle); leaving it stops the stream.
// The sound itself is lib/radio/radio.js; the station list is public/data/radio-stations.json.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { useRadio, initRadio, setPower, setPlaying, selectStation, stepStation, setInVehicle } from "@/lib/radio/radio.js";
import { useMix } from "@/lib/audio/mixer.js";
import { groupStations, placeOf } from "@/lib/radio/stations.js";
import "./car-radio.css";

/** What the panel says under the station name. */
export function radioLine(r) {
  if (!r.on) return "Radio off";
  if (!r.stations.length) return r.loaded ? (r.listFailed ? "Couldn't load the stations. Check your connection." : "No stations available right now") : "Loading stations…";
  const track = [r.artist, r.track].filter(Boolean).join(" · ");
  switch (r.status) {
    case "loading": return "Connecting…";
    case "buffering": return "Buffering…";
    case "reconnecting": return `Reconnecting… (${Math.min(r.attempt, 5)}/5)`;
    case "error": return r.error || "Could not play this station";
    case "tap": return r.error || "Tap play to start";
    case "paused": return "Paused";
    case "playing": return track || [r.stations.find((s) => s.id === r.stationId)?.genre, placeOf(r.stations.find((s) => s.id === r.stationId) ?? {})].filter(Boolean).join(" · ") || "On air";
    default: return "Ready";
  }
}

/** A station's logo, or its initials when it has none or the image does not load (the radio never shows a broken image). Give it key={station.id} so a new station starts fresh. */
function StationLogo({ s }) {
  const [bad, setBad] = useState(false), showImg = !!s.logo && !bad;
  const initials = s.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || s.name.slice(0, 1).toUpperCase();
  return <span className="cr-logo" data-fallback={showImg ? undefined : "1"} aria-hidden="true">{showImg ? <img src={s.logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : initials}</span>;
}

export default function CarRadio({ active, float = false }) {
  const r = useRadio(), mix = useMix(), [open, setOpen] = useState(false), [list, setList] = useState(false), panel = useRef(null), btn = useRef(null);
  // The panel and the chip are placed against the SCREEN (the HUD root, .th), but the button lives inside the pedal cluster, whose boxes are positioned themselves: left unattended, the panel would be
  // positioned against the pedals and land off screen. So they are rendered into the HUD root. host: undefined = not mounted yet, null = no HUD around (render in place), element = the HUD root.
  const [host, setHost] = useState(undefined);
  const setBtn = useCallback((el) => { btn.current = el; setHost(el ? el.closest(".th") : undefined); }, []);
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
  useEffect(() => { if (list) panel.current?.querySelector('.cr-list [aria-current="true"]')?.scrollIntoView({ block: "nearest" }); }, [list]); // opening the stations shows the one that is playing
  if (!active) return null;
  const power = () => { setPower(!r.on); if (!r.on) setOpen(true); };
  const floating = (
    <>
      {!open && r.on && r.stations.length > 0 && <button type="button" className="cr-chip" onClick={() => setOpen(true)} data-sound="none" aria-label={`Radio: ${cur?.name ?? ""}. ${radioLine(r)}. Open the radio`}><i className="cr-eq" data-busy={busy ? "1" : undefined} data-live={r.status === "playing" ? "1" : undefined} aria-hidden="true"><b /><b /><b /></i><span>{cur?.name}</span></button>}
      {open && (
        <div ref={panel} className="cr" role="dialog" aria-label="Car radio">
          <header>
            <button type="button" className="cr-pw" data-on={r.on ? "1" : undefined} aria-pressed={r.on} aria-label={r.on ? "Turn the radio off" : "Turn the radio on"} data-sound="none" onClick={power}><Icon name="power" size={18} weight="bold" /></button>
            <b>Car radio</b>
            <button type="button" className="cr-x ghost" aria-label="Close the radio" data-sound="none" onClick={() => setOpen(false)}><Icon name="close" size={18} /></button>
          </header>
          <div className="cr-screen" data-on={r.on ? "1" : undefined}>
            {r.on && cur && <StationLogo key={cur.id} s={cur} />}
            <div className="cr-txt"><b>{r.on ? cur?.name ?? "No station" : "—"}</b><span role="status" aria-live="polite">{radioLine(r)}</span></div>
            <i className="cr-eq" data-busy={busy ? "1" : undefined} data-live={r.status === "playing" ? "1" : undefined} aria-hidden="true"><b /><b /><b /><b /></i>
            {busy && <i className="cr-spin" aria-hidden="true" />}
          </div>
          <div className="cr-ctl">
            <button type="button" aria-label="Previous station" disabled={!r.stations.length} data-sound="none" onClick={() => stepStation(-1)}><Icon name="prevStation" size={20} weight="fill" /></button>
            <button type="button" className="cr-play" aria-label={r.on && !r.paused ? "Pause" : "Play"} disabled={!r.stations.length} data-sound="none" onClick={() => (r.on ? setPlaying(r.paused || r.status === "error" || r.status === "tap") : setPower(true))}><Icon name={r.on && !r.paused && r.status !== "error" && r.status !== "tap" ? "pause" : "play"} size={24} weight="fill" /></button>
            <button type="button" aria-label="Next station" disabled={!r.stations.length} data-sound="none" onClick={() => stepStation(1)}><Icon name="nextStation" size={20} weight="fill" /></button>
          </div>
          {mix.masterMute && <p className="cr-note">Everything is muted in Settings.</p>}
          {r.stations.length > 1 && <button type="button" className="cr-more ghost" aria-expanded={list} data-sound="none" onClick={() => setList((l) => !l)}>{list ? "Hide stations" : `Stations (${r.stations.length})`}</button>}
          {list && <ul className="cr-list" aria-label="Stations">{groupStations(r.stations).map((g) => <li key={g.region}><span className="cr-region">{g.region}</span><ul>{g.stations.map((s) => <li key={s.id}><button type="button" aria-current={s.id === r.stationId ? "true" : undefined} data-sound="none" onClick={() => { selectStation(s.id); }}><StationLogo key={s.id} s={s} /><b>{s.name}</b><small>{[s.genre, placeOf(s)].filter(Boolean).join(" · ")}</small></button></li>)}</ul></li>)}</ul>}
          <p className="cr-key" aria-hidden="true"><kbd>R</kbd> radio <kbd>,</kbd><kbd>.</kbd> station</p>
        </div>
      )}
    </>
  );
  return (
    <>
      <button ref={setBtn} type="button" className={"th-btn th-radio" + (float ? " th-radio-float" : "")} data-on={r.on ? "1" : undefined} aria-label={open ? "Close the car radio" : "Open the car radio"} aria-expanded={open} data-sound="none" onClick={() => setOpen((o) => !o)}>
        <Icon name="radio" size={22} weight={r.on ? "fill" : "regular"} />
      </button>
      {host === undefined ? null : host ? createPortal(floating, host) : floating}
    </>
  );
}
