import type { ReactNode } from "react";
import type { PhonePlatform } from "@campuslife/shared";
import { PiArrowLeftBold, PiCaretLeftBold } from "react-icons/pi";

interface AppFrameProps {
  platform: PhonePlatform;
  title: string;
  onBack: () => void;
  children: ReactNode;
  balance?: string;
}

export function AppFrame({ platform, title, onBack, children, balance }: AppFrameProps) {
  return (
    <div className="ph-app">
      <header className="ph-app-bar">
        <button type="button" className="ph-back" onClick={onBack} aria-label="Back to home screen">
          {platform === "ios" ? <PiCaretLeftBold aria-hidden="true" /> : <PiArrowLeftBold aria-hidden="true" />}
          {platform === "ios" && <span aria-hidden="true">Home</span>}
        </button>
        <h2 className="ph-app-title">{title}</h2>
        {balance && <span className="ph-app-cash" aria-label={`Wallet balance ${balance}`}>{balance}</span>}
      </header>
      <div className="ph-app-body">{children}</div>
    </div>
  );
}
