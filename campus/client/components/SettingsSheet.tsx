"use client";

import { SENSITIVITY_MAX, SENSITIVITY_MIN, SENSITIVITY_STEP, VOLUME_MAX, VOLUME_MIN, VOLUME_STEP, type ControlSettings, type SoundSettings } from "@campus/lib/settings";
import { GameIcon } from "./GameIcon";
import { GamePanel } from "./GamePanel";
import "./account/account.css";

interface Props {
  controls: ControlSettings;
  sound: SoundSettings;
  touch: boolean;
  handle: string;
  onChange: (controls: ControlSettings) => void;
  onSoundChange: (sound: SoundSettings) => void;
  onSignOut: () => void;
  onClose: () => void;
}

const TOGGLES: { key: "keyboard" | "tapToWalk" | "invertY"; title: string; detail: string }[] = [
  { key: "keyboard", title: "Keyboard controls", detail: "WASD or arrow keys to walk. Q and E turn, R and V tilt, Z and X zoom, C resets the camera." },
  { key: "tapToWalk", title: "Tap to walk", detail: "Tap or click the ground to walk there." },
  { key: "invertY", title: "Invert camera tilt", detail: "Flip the up and down drag direction." },
];

const SOUND_COPY = { title: "Sound", detail: "Birds, crickets and campus background sound.", volume: "Volume" };

const ACCOUNT_COPY = { signedIn: "Signed in as", signOut: "Sign out" };

export default function SettingsSheet({ controls, sound, touch, handle, onChange, onSoundChange, onSignOut, onClose }: Props) {
  return (
    <GamePanel className="sheet jobs" label="Settings" onClose={onClose}>
      <div className="jobs-head">
        <h2><GameIcon name="settings" />Settings</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <GameIcon name="close" />
        </button>
      </div>
      <div className="settings-list">
        {TOGGLES.map((t) => (
          <label key={t.key} className="setting">
            <span className="setting-text">
              <b>{t.title}</b>
              <small>{t.detail}</small>
            </span>
            <input type="checkbox" role="switch" className="setting-switch" checked={controls[t.key]} onChange={(e) => onChange({ ...controls, [t.key]: e.target.checked })} />
          </label>
        ))}
        <label className="setting setting-range">
          <span className="setting-text">
            <b>Camera speed</b>
            <small>{Math.round(controls.sensitivity * 100)}%</small>
          </span>
          <input
            type="range"
            min={SENSITIVITY_MIN}
            max={SENSITIVITY_MAX}
            step={SENSITIVITY_STEP}
            value={controls.sensitivity}
            onChange={(e) => onChange({ ...controls, sensitivity: Number(e.target.value) })}
          />
        </label>
        <label className="setting">
          <span className="setting-text">
            <b>{SOUND_COPY.title}</b>
            <small>{SOUND_COPY.detail}</small>
          </span>
          <input type="checkbox" role="switch" className="setting-switch" checked={sound.enabled} onChange={(e) => onSoundChange({ ...sound, enabled: e.target.checked })} />
        </label>
        <label className="setting setting-range">
          <span className="setting-text">
            <b>{SOUND_COPY.volume}</b>
            <small>{Math.round(sound.volume * 100)}%</small>
          </span>
          <input
            type="range"
            min={VOLUME_MIN}
            max={VOLUME_MAX}
            step={VOLUME_STEP}
            value={sound.volume}
            disabled={!sound.enabled}
            onChange={(e) => onSoundChange({ ...sound, volume: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="settings-account">
        <span className="setting-text">
          <small>{ACCOUNT_COPY.signedIn}</small>
          <b>{handle}</b>
        </span>
        <button type="button" className="btn btn-ghost" onClick={onSignOut}>
          <GameIcon name="signOut" />
          {ACCOUNT_COPY.signOut}
        </button>
      </div>
      <p className="jobs-foot">
        {touch
          ? "Drag with one finger to look around. Pinch to zoom, twist to turn, and drag with two fingers to move the camera."
          : "Drag to look around and scroll to zoom. Right-drag or Shift-drag moves the camera away from you."}
      </p>
    </GamePanel>
  );
}
