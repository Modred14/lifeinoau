import type { PhonePlatform } from "@campuslife/shared";
import { PiCaretLeftBold, PiCircleBold } from "react-icons/pi";

export function NavBar({ platform, active, onHome }: { platform: PhonePlatform; active: boolean; onHome: () => void }) {
  if (platform === "ios") {
    if (!active) return <div className="ph-nav" aria-hidden="true"><span className="ph-handle" /></div>;
    return (
      <div className="ph-nav">
        <button type="button" className="ph-handle-btn" onClick={onHome} aria-label="Go to home screen">
          <span className="ph-handle" />
        </button>
      </div>
    );
  }
  return (
    <div className="ph-nav">
      <button type="button" className="ph-nav-btn" onClick={onHome} disabled={!active} aria-label="Back">
        <PiCaretLeftBold aria-hidden="true" />
      </button>
      <button type="button" className="ph-nav-btn" onClick={onHome} disabled={!active} aria-label="Home screen">
        <PiCircleBold aria-hidden="true" />
      </button>
    </div>
  );
}
