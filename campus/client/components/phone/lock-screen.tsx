import type { PhonePlatform } from "@campuslife/shared";
import { PHONE_CARRIER } from "@campuslife/shared";
import { PiLockSimpleFill } from "react-icons/pi";
import { findApp } from "./apps";
import { AppIcon } from "./app-icon";
import type { LockNotification } from "./lock-notification";

interface LockScreenProps {
  platform: PhonePlatform;
  day: string;
  time: string;
  notification: LockNotification | null;
  onUnlock: () => void;
}

export function LockScreen({ platform, day, time, notification, onUnlock }: LockScreenProps) {
  const app = notification ? findApp(notification.app) : null;
  return (
    <button type="button" className="ph-lock" onClick={onUnlock} aria-label={`Phone locked. ${day} ${time}. Open phone`}>
      <span className="ph-lock-top">
        <PiLockSimpleFill className="ph-lock-icon" aria-hidden="true" />
        <span className="ph-lock-day">{day}</span>
        <span className="ph-lock-time">{time}</span>
        {platform === "android" && <span className="ph-lock-carrier">{PHONE_CARRIER}</span>}
      </span>
      {notification && app && (
        <span className="ph-notice">
          <AppIcon app={app} small />
          <span className="ph-notice-text">
            <span className="ph-notice-app">{app.label}</span>
            <b>{notification.title}</b>
            <span>{notification.body}</span>
          </span>
        </span>
      )}
      <span className="ph-lock-hint">{platform === "ios" ? "Tap to open" : "Tap to unlock"}</span>
    </button>
  );
}
