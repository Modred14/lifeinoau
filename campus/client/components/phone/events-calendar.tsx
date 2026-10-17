import { DAYS, FACULTY_TEAMS, SOCIAL_SITES, SPECIAL_TRADES, STALLS, freshBatch, nextBatch, stallOpen, weekCalendar, weekOf, weekPlan, type CalendarEvent } from "@campuslife/shared";
import { PiCalendarStarFill, PiFireFill, PiMoonFill, PiPencilLineFill } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";
import type { Social } from "@campus/game/social/use-social";
import { hhmm, naira } from "./format";

const TEXT = {
  week: (name: string) => `${name} Week`,
  yours: "Na your faculty week. Morning toast and extra fun at every faculty event.",
  union: "Students' Union Week is on.",
  empty: "Quiet week. Check the Today tab for shows.",
  go: "Go",
  free: "Free",
  live: "on now",
  done: "done",
  night: "Night food",
  risky: (open: boolean) => (open ? "Risky is open now. The only food after midnight." : `Risky opens ${hhmm(SPECIAL_TRADES.risky.open)} till ${hhmm(SPECIAL_TRADES.risky.close)}.`),
  hot: (fresh: boolean, next: number | undefined, open: boolean) => (fresh ? "As E Dey Hot: fresh batch just landed. Run!" : open && next !== undefined ? `As E Dey Hot: next hot batch about ${hhmm(next)}.` : `As E Dey Hot fries ${hhmm(SPECIAL_TRADES.hot.open)} to ${hhmm(SPECIAL_TRADES.hot.close)}, opposite Alumni Hall.`),
  shirt: (count: number) => `Your sign-out shirt: ${count} signature${count === 1 ? "" : "s"} today.`,
  signed: (count: number) => `Shirts you signed today: ${count}`,
};
const priceOf = (stall: number | undefined) => (stall === SOCIAL_SITES.stalls.risky ? SPECIAL_TRADES.risky.price : SPECIAL_TRADES.hot.price);
const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

function StallRow({ view, stall, text, fresh, onClose }: { view: CampusView; stall: number | undefined; text: string; fresh: boolean; onClose: () => void }) {
  const at = stall === undefined ? undefined : STALLS[stall];
  if (!at) return null;
  const Icon = fresh ? PiFireFill : PiMoonFill;
  return (
    <li className={fresh ? "ph-list-row ph-live" : "ph-list-row"}>
      <span className="ph-list-text">
        <b>
          <Icon aria-hidden="true" /> {at.name.split(":")[0]}
        </b>
        <small>{text}</small>
        <small>{naira(priceOf(stall))}</small>
      </span>
      <button
        type="button"
        className="ph-btn"
        aria-label={`Go to ${at.name}`}
        onClick={() => {
          view.goTo({ x: at.x, y: at.y }, at.name.split(":")[0]);
          onClose();
        }}
      >
        {TEXT.go}
      </button>
    </li>
  );
}

export function EventsCalendar({ view, social, onClose }: { view: CampusView; social: Social; onClose: () => void }) {
  const { time, status } = social;
  const week = weekOf(time.dayIndex);
  const plan = weekPlan(week);
  const team = FACULTY_TEAMS[plan.faculty];
  const events = weekCalendar(week);
  const go = (event: CalendarEvent) => {
    view.goTo(event.at, event.where);
    onClose();
  };
  const risky = SOCIAL_SITES.stalls.risky;
  const hot = SOCIAL_SITES.stalls.hot;
  const fresh = freshBatch(time);
  return (
    <>
      {team ? (
        <h3 className="ph-heading">
          <PiCalendarStarFill aria-hidden="true" /> {TEXT.week(team.name)}
        </h3>
      ) : null}
      {team && status?.faculty === team.index ? <p className="ph-note">{TEXT.yours}</p> : null}
      {plan.union ? <p className="ph-note">{TEXT.union}</p> : null}
      {status?.finalist && status.shirt > 0 ? (
        <p className="ph-note">
          <PiPencilLineFill aria-hidden="true" /> {TEXT.shirt(status.shirt)}
        </p>
      ) : null}
      {status && status.signed.length > 0 ? <p className="ph-note">{TEXT.signed(status.signed.length)}</p> : null}
      {events.length ? (
        <ul className="ph-list">
          {events.map((event) => {
            const live = time.total >= event.startTotal && time.total < event.endTotal;
            const over = time.total >= event.endTotal;
            return (
              <li key={event.key} className={live ? "ph-list-row ph-live" : "ph-list-row"}>
                <span className="ph-time">
                  <small>{DAYS[event.dayIndex - week * 7]?.slice(0, 3)} </small>
                  {hhmm(event.start)}
                </span>
                <span className="ph-list-text">
                  <b>
                    <PiCalendarStarFill aria-hidden="true" style={{ color: hex(event.color) }} /> {event.title}
                  </b>
                  <small>{event.detail}</small>
                  <small>
                    {event.where} · {event.fee > 0 ? naira(event.fee) : TEXT.free}
                    {live ? ` · ${TEXT.live}` : over ? ` · ${TEXT.done}` : ""}
                  </small>
                </span>
                <button type="button" className="ph-btn" disabled={over} onClick={() => go(event)} aria-label={`Go to ${event.title}`}>
                  {TEXT.go}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ph-note">{TEXT.empty}</p>
      )}
      <h3 className="ph-heading">{TEXT.night}</h3>
      <ul className="ph-list">
        <StallRow view={view} stall={risky} text={TEXT.risky(risky !== undefined && stallOpen(risky, time))} fresh={false} onClose={onClose} />
        <StallRow view={view} stall={hot} text={TEXT.hot(fresh, nextBatch(time), hot !== undefined && stallOpen(hot, time))} fresh={fresh} onClose={onClose} />
      </ul>
    </>
  );
}
