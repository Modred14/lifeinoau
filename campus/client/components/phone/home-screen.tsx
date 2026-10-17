import { vitalityMessage, type PhonePlatform } from "@campuslife/shared";
import { PiWalletFill, PiForkKnifeFill } from "react-icons/pi";
import type { PhoneLive } from "./use-phone-live";
import { naira } from "./format";
import { PHONE_APPS, type AppId, type PhoneApp } from "./apps";
import { AppIcon } from "./app-icon";

interface HomeScreenProps {
  platform: PhonePlatform;
  day: string;
  badges: Partial<Record<AppId, number>>;
  live: PhoneLive;
  onOpen: (id: AppId) => void;
}

function label(app: PhoneApp, badge: number): string {
  return badge > 0 ? `${app.label}, ${badge} waiting` : app.label;
}

export function HomeScreen({ platform, day, badges, live, onOpen }: HomeScreenProps) {
  const tile = (app: PhoneApp, showLabel: boolean) => {
    const badge = badges[app.id] ?? 0;
    const display = app.id === "browser" ? { ...app, label: platform === "ios" ? "Safari" : "Chrome", image: `/campus/phone/apps/${platform === "ios" ? "safari" : "chrome"}.webp` } : app;
    return (
      <li key={app.id}>
        <button type="button" className="ph-tile" data-app={app.id} onClick={() => onOpen(app.id)} aria-label={label(display, badge)}>
          <AppIcon app={display} badge={badge} />
          {showLabel && <span className="ph-tile-label" aria-hidden="true">{display.label}</span>}
        </button>
      </li>
    );
  };
  return (
    <div className="ph-home">
      {platform === "android" && <p className="ph-glance">{day}</p>}
      <div className="ph-widgets">
        <button type="button" className="ph-wallet-widget" onClick={() => onOpen("wallet")} aria-label={`Wallet balance ${naira(live.cash)}`}><span><PiWalletFill aria-hidden="true" />Wallet</span><b>{naira(live.cash)}</b><small>Available balance</small></button>
        <button type="button" className="ph-needs-widget" onClick={() => onOpen("chowdeck")} aria-label={`Food ${live.food} percent, energy ${live.energy} percent. Order food`}><span><PiForkKnifeFill aria-hidden="true" />{live.food < 30 ? "Time to eat" : "Feeling good"}</span><b>{live.food}% <small>food</small></b><small>Energy {live.energy}%</small></button>
      </div>
      {vitalityMessage(live) && <p className="ph-home-warning">{vitalityMessage(live)}</p>}
      <ul className="ph-grid" aria-label="Apps">
        {PHONE_APPS.filter((app) => !app.dock).map((app) => tile(app, true))}
      </ul>
      <ul className="ph-dock" aria-label="Dock">
        {PHONE_APPS.filter((app) => app.dock).map((app) => tile(app, platform === "android"))}
      </ul>
    </div>
  );
}
