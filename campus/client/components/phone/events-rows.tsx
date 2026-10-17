import type { WhatsOnItem } from "@campuslife/shared";
import { PiCalendarStarFill, PiSoccerBallFill, PiTicketFill } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";
import { hhmm, naira } from "./format";

const TEXT = { free: "Free", gate: "Gate", live: "on now", go: "Go" };
const ICONS = { show: PiTicketFill, match: PiSoccerBallFill, pitch: PiSoccerBallFill, event: PiCalendarStarFill };
const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

export function EventRows({ view, items, total, empty, day, onClose }: { view: CampusView; items: readonly WhatsOnItem[]; total: number; empty: string; day?: (item: WhatsOnItem) => string; onClose: () => void }) {
  if (!items.length) return <p className="ph-note">{empty}</p>;
  const go = (item: WhatsOnItem) => {
    view.goTo(item.go ?? item.door, item.venue);
    onClose();
  };
  return (
    <ul className="ph-list">
      {items.map((item) => {
        const live = total >= item.startTotal && total < item.endTotal;
        const Icon = ICONS[item.type];
        return (
          <li key={`${item.type}-${item.id}`} className={live ? "ph-list-row ph-live" : "ph-list-row"}>
            <span className="ph-time">
              {day ? <small>{day(item)} </small> : null}
              {hhmm(item.start)}
            </span>
            <span className="ph-list-text">
              <b>
                <Icon aria-hidden="true" style={{ color: hex(item.color) }} /> {item.title}
              </b>
              <small>{item.detail}</small>
              <small>
                {item.venue} · {item.fee > 0 ? `${TEXT.gate} ${naira(item.fee)}` : TEXT.free}
                {live ? ` · ${TEXT.live}` : ""}
              </small>
            </span>
            <button type="button" className="ph-btn" onClick={() => go(item)} aria-label={`Go to ${item.title} at ${item.venue}`}>
              {TEXT.go}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
