// components/apps/SettingsApp.js: the phone's Settings icon.
// The real Settings screen (profile, character, account, gameplay, audio, notifications, privacy, accessibility) is a full-screen page drawn by Shell (components/SettingsScreen.js),
// because it needs the whole window for the 3D character preview. Opening this app puts the handset away and opens that screen.
"use client";
import { useEffect } from "react";

export default function SettingsApp({ onClose }) {
  useEffect(() => {
    onClose?.();
    window.dispatchEvent(new CustomEvent("oau:settings"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
