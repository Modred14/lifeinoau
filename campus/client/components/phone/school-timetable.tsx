import { hhmm } from "./format";
import type { Timetable } from "./lock-notification";

type ClassItem = Timetable["lectures"][number];
type Go = (target: { x: number; y: number }, name: string) => void;

const TAG: Record<ClassItem["state"], { label: string; tone: string } | null> = {
  holding: null,
  shifted: { label: "Shifted", tone: "ph-tag ph-tag-warn" },
  late: { label: "Lecturer late", tone: "ph-tag ph-tag-warn" },
  on: { label: "On now", tone: "ph-tag" },
  cancelled: { label: "Cancelled", tone: "ph-tag ph-tag-bad" },
  done: { label: "Done", tone: "ph-tag" },
};
const BOYCOTT_TAG = { label: "Boycott", tone: "ph-tag ph-tag-warn" };
const CARRY_TAG = { label: "Carry-over", tone: "ph-tag ph-tag-warn" };
const NO_CLASS_TODAY = "No class today. Rest, read or go flex.";
const NO_CLASS = "No class";
const WEEK_NOTE = "Lecturers can come late, shift a class or not show at all. You will know on the day.";

function rowClass(item: ClassItem): string {
  if (item.state === "done" || item.state === "cancelled") return "ph-list-row ph-done";
  return item.state === "on" ? "ph-list-row ph-live" : "ph-list-row";
}

function ClassRow({ item, go }: { item: ClassItem; go?: Go }) {
  const tag = item.boycott ? BOYCOTT_TAG : item.sheet ? { label: "Sheet going round", tone: "ph-tag ph-tag-warn" } : item.signed ? { label: "Signed", tone: "ph-tag" } : item.carry && item.state === "holding" ? CARRY_TAG : TAG[item.state];
  const open = item.state !== "done" && item.state !== "cancelled";
  return (
    <li className={rowClass(item)}>
      <span className="ph-time">{hhmm(item.start)}</span>
      <span className="ph-list-text">
        <b>{item.course}</b>
        <small>
          {item.venue} · {item.lecturer}
        </small>
        {item.note && <small>{item.note}</small>}
        {tag && <span className={tag.tone}>{tag.label}</span>}
      </span>
      {go && open && (
        <button type="button" className="ph-btn" onClick={() => go(item.door, item.venue)} aria-label={`Go to ${item.code} at ${item.venue}`}>
          Go
        </button>
      )}
    </li>
  );
}

export function SchoolToday({ timetable, go }: { timetable: Timetable; go: Go }) {
  return (
    <>
      <h3 className="ph-heading">Today · {timetable.today}</h3>
      {timetable.lectures.length ? (
        <ul className="ph-list">
          {timetable.lectures.map((item) => (
            <ClassRow key={item.key} item={item} go={go} />
          ))}
        </ul>
      ) : (
        <p className="ph-note">{NO_CLASS_TODAY}</p>
      )}
      <h3 className="ph-heading">Every week</h3>
      <ul className="ph-list">
        {timetable.events.map((event) => (
          <li key={event.title} className="ph-list-row">
            <span className="ph-time">{hhmm(event.start)}</span>
            <span className="ph-list-text">
              <b>{event.title}</b>
              <small>{event.days}</small>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function SchoolWeek({ timetable }: { timetable: Timetable }) {
  return (
    <>
      <p className="ph-note">{WEEK_NOTE}</p>
      {timetable.week.map((day) => (
        <section key={day.name}>
          <h3 className="ph-heading">
            {day.name}
            {day.today ? " · today" : ""}
          </h3>
          {day.classes.length ? (
            <ul className="ph-list">
              {day.classes.map((item) => (
                <ClassRow key={item.key} item={item} />
              ))}
            </ul>
          ) : (
            <p className="ph-note">{NO_CLASS}</p>
          )}
        </section>
      ))}
    </>
  );
}
