// components/ClubMusicPlayer.js
// The music screen of a club (mounted by ClubLayer): what the DJ is playing, play / pause / skip, its own volume and mute, a "tap to start" prompt for browsers
// that refuse sound until a tap, and a soft light pulse on the beat in the club's colour. The audio is lib/clubDj.js. Nothing here touches the sound-effect
// settings: music is turned down, muted or switched off on its own.
"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useSoundSettings } from "@/lib/sound";
import { useClubDj, startClubMusic, stopClubMusic, setClubVolume, setClubMuted, pauseClubMusic, resumeClubMusic, skipClubTrack, tapToStart, visual } from "@/lib/clubDj";
import { setOf } from "@/lib/clubMusic.js";
import "./club-music.css";

const NOTES = { "needs-tap": "Tap to start the club music", off: "Music is off in Settings", unsupported: "This browser can't play the club mix", starting: "The DJ is warming up" };

export default function ClubMusicPlayer({ club, live = true }) {
  const dj = useClubDj(), { music } = useSoundSettings(), [open, setOpen] = useState(false), glow = useRef(null);
  useEffect(() => { // the mix plays while you are inside and the club is open, and only if the game's music is on
    if (!live) { stopClubMusic(); return; }
    if (!music) { stopClubMusic("off"); return; }
    startClubMusic(club.id);
    return () => stopClubMusic();
  }, [club.id, live, music]);
  useEffect(() => { // lights that follow the beat: two CSS variables on one element, no React renders; still when the player is hidden or the system asks for less motion
    const el = glow.current, calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || calm || dj.status !== "playing") { el?.style.setProperty("--lv", "0"); return; }
    let raf = 0, last = 0;
    const frame = (t) => { raf = requestAnimationFrame(frame); if (document.hidden || t - last < 33) return; last = t; const v = visual(); el.style.setProperty("--bt", String(Math.max(0, 1 - v.phase * 1.6))); el.style.setProperty("--lv", String(v.level)); };
    raf = requestAnimationFrame(frame); return () => cancelAnimationFrame(raf);
  }, [dj.status]);

  const playing = dj.status === "playing", note = NOTES[dj.status], now = dj.now, vol = dj.muted ? 0 : dj.volume;
  return (
    <>
      <div className="cm-glow" ref={glow} style={{ "--neon": club.neon }} aria-hidden="true" />
      <div className="cm" style={{ "--neon": club.neon }} data-open={open ? "1" : undefined}>
        {open && (
          <div className="cm-panel" role="group" aria-label="Club music">
            <p className="cm-set">{setOf(club.id).dj} · {setOf(club.id).note}</p>
            {now && <p className="cm-tag">{now.genre} · {now.source}{dj.mixing ? " · mixing" : ""}</p>}
            <div className="cm-ctl">
              <button type="button" data-sound="none" onClick={() => (playing ? pauseClubMusic() : dj.status === "paused" ? resumeClubMusic() : tapToStart())} aria-label={playing ? "Pause the music" : "Play the music"}><Icon name={playing ? "pause" : "play"} size={20} weight="fill" /></button>
              <button type="button" data-sound="none" onClick={skipClubTrack} disabled={!playing || dj.mixing} aria-label="Next track"><Icon name="skip" size={20} weight="fill" /></button>
              <button type="button" data-sound="none" onClick={() => setClubMuted(!dj.muted)} aria-pressed={dj.muted} aria-label={dj.muted ? "Unmute the music" : "Mute the music"}><Icon name={dj.muted ? "mute" : "sound"} size={20} weight="fill" /></button>
              <input type="range" min="0" max="100" value={vol} onChange={(e) => { setClubVolume(+e.target.value); if (dj.muted && +e.target.value > 0) setClubMuted(false); }} aria-label="Music volume" />
            </div>
            <p className="cm-fine">Music volume and mute are separate from sound effects. Turn the game's music off for good in Settings.</p>
            {dj.next && <p className="cm-next">Next: {dj.next.title}</p>}
          </div>
        )}
        <button type="button" className="cm-pill" data-sound="none" aria-expanded={open} onClick={() => (dj.status === "needs-tap" ? tapToStart() : setOpen(!open))}>
          <span className="cm-eq" data-on={playing && !dj.muted ? "1" : undefined} aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="cm-now"><b>{now && playing ? now.title : note ?? (dj.status === "paused" ? "Music paused" : "Club music")}</b>{now && playing && <small>{now.artist}</small>}</span>
          <Icon name={open ? "down" : "up"} size={16} weight="bold" />
        </button>
        {dj.error && <p className="cm-err" role="status">{dj.error}</p>}
      </div>
    </>
  );
}