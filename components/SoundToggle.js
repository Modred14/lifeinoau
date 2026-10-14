// components/SoundToggle.js
// A small mute button for the screens where the phone isn't reachable yet (landing page, sign up, character creation),
// so the music can always be switched off. Once you are in the game the Settings app on the phone does this job.
"use client";
import { Icon } from "./Icon";
import { setSoundSettings, playSound, useSoundSettings } from "@/lib/sound";
import "./sound-toggle.css";

export default function SoundToggle() {
  const { music, sfx } = useSoundSettings(),
    muted = !music && !sfx;
  return (
    <button
      type="button"
      className="sndt"
      data-sound="none"
      aria-pressed={muted}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      onClick={() => {
        setSoundSettings({ music: muted, sfx: muted }); // either one on = mute both; both off = turn both on
        playSound(muted ? "on" : "off");
      }}
    >
      <Icon name={muted ? "mute" : "sound"} size={20} weight="fill" />
    </button>
  );
}