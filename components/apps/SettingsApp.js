// components/apps/SettingsApp.js: lives inside the phone (see components/Phone.js)
// Turn the background song and the tap and click sounds on or off, separately or both. Saved on this device (lib/sound.js).
"use client";
import { Icon } from "../Icon";
import { MUSIC, playSound, setSoundSettings, useSoundSettings } from "@/lib/sound";
import "./settings-app.css";

/** One row with an on/off switch. The input is a real checkbox with role="switch", so keyboards and screen readers get it for free. */
function Row({ icon, tone, title, note, checked, onChange }) {
  return (
    <label className="st-row" data-sound="none">
      <span className="ph-ico st-ico" data-tone={tone}>
        <Icon name={icon} size={20} weight="fill" />
      </span>
      <span className="st-txt">
        <b>{title}</b>
        <small>{note}</small>
      </span>
      <input type="checkbox" role="switch" className="st-in" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="st-track" aria-hidden="true" />
    </label>
  );
}

export default function SettingsApp() {
  const { music, sfx } = useSoundSettings();
  // Save first, then play the blip, so turning effects ON is heard and turning them OFF is silent.
  const set = (patch) => (on) => {
    setSoundSettings(patch(on));
    playSound(on ? "on" : "off");
  };
  return (
    <div className="st">
      <h3 className="st-h">Sound</h3>
      <div className="st-group">
        <Row
          icon="music"
          tone="rose"
          title="Background music"
          note={`${MUSIC.title} · ${MUSIC.artist}`}
          checked={music}
          onChange={set((on) => ({ music: on }))}
        />
        <Row
          icon="sound"
          tone="blue"
          title="Sound effects"
          note="Taps, clicks and alerts"
          checked={sfx}
          onChange={set((on) => ({ sfx: on }))}
        />
      </div>
      <p className="st-foot">
        {!music && !sfx ? "The game is silent." : "Switch both off for a silent game."} Your choice is remembered on this device.
      </p>
    </div>
  );
}