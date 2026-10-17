import { PiBedFill } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";

type Hostel = ReturnType<CampusView["getAdmin"]>["hostel"];

const MINUTES_PER_HOUR = 60;
const TEXT = {
  heading: "Bed space",
  yours: (hall: string) => `Your bed space this semester: ${hall}. You rest better there.`,
  open: (fee: string) => `Ballot is open. One try this semester. Fee is ${fee} if you win.`,
  tried: "Bed spaces exhausted. You fit squat in any hostel, but rest is slower and porter fit come.",
  soon: (when: string) => `Ballot opens in ${when}. It runs Tuesday 09:00 to 15:00, with a late ballot Thursday 16:00.`,
  closed: "Ballot is closed till next semester. You fit squat in any hostel, but rest is slower and porter fit come.",
  odds: (beds: number, applicants: number) => `${beds} beds · ${applicants} applicants`,
  ballot: "Ballot",
};

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;
const span = (minutes: number) => (minutes >= MINUTES_PER_HOUR ? `${Math.floor(minutes / MINUTES_PER_HOUR)}h ${minutes % MINUTES_PER_HOUR}m` : `${minutes}m`);

function note(hostel: Hostel): string {
  if (hostel.bed) return TEXT.yours(hostel.bed);
  if (hostel.ballotOpen) return TEXT.open(naira(hostel.fee));
  if (hostel.tried) return TEXT.tried;
  return hostel.opensIn >= 0 ? TEXT.soon(span(hostel.opensIn)) : TEXT.closed;
}

export function SchoolHostel({ view, hostel }: { view: CampusView; hostel: Hostel }) {
  return (
    <>
      <h3 className="ph-heading">{TEXT.heading}</h3>
      <p className="ph-note">{note(hostel)}</p>
      {hostel.bed ? (
        <span className="ph-tag">
          <PiBedFill aria-hidden="true" /> {hostel.bed}
        </span>
      ) : (
        <ul className="ph-list">
          {hostel.halls.map((hall) => (
            <li key={hall.place} className="ph-list-row">
              <span className="ph-list-text">
                <b>{hall.name}</b>
                <small>{TEXT.odds(hall.beds, hall.applicants)}</small>
              </span>
              <button type="button" className="ph-btn" disabled={!hostel.ballotOpen} onClick={() => view.sendAdmin({ a: "ballot", hall: hall.place })} aria-label={`Ballot for ${hall.name}`}>
                {TEXT.ballot}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
