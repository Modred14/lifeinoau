import { weekClock, type SemesterView } from "@campuslife/shared";

type Entry = SemesterView["entries"][number];

const TEXT = {
  heading: (name: string, session: string) => `${name} · ${session}`,
  now: (phase: string, left: string) => `Now: ${phase}. ${left} left.`,
  note: "Everyone shares this campus week. Your degree progresses through OAU Life’s academic sessions.",
  from: (start: string) => start,
  span: (start: string, end: string) => `${start} to ${end}`,
};
const TAG: Record<Entry["stage"], { label: string; tone: string } | null> = {
  done: { label: "Done", tone: "ph-tag" },
  now: { label: "On now", tone: "ph-tag ph-tag-warn" },
  next: null,
};
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

function span(minutes: number): string {
  const days = Math.floor(minutes / (MINUTES_PER_HOUR * HOURS_PER_DAY));
  const hours = Math.floor(minutes / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes % MINUTES_PER_HOUR}m` : `${minutes}m`;
}

function rowClass(entry: Entry): string {
  if (entry.stage === "done") return "ph-list-row ph-done";
  return entry.stage === "now" ? "ph-list-row ph-live" : "ph-list-row";
}

export function SchoolCalendar({ semester }: { semester: SemesterView }) {
  return (
    <>
      <h3 className="ph-heading">{`Campus week ${semester.semester + 1}`}</h3>
      <p className="ph-note">
        {TEXT.now(semester.phase.title, span(semester.endsIn))} {TEXT.note}
      </p>
      <ol className="ph-list">
        {semester.entries.map((entry) => {
          const tag = TAG[entry.stage];
          return (
            <li key={entry.id} className={rowClass(entry)}>
              <span className="ph-list-text">
                <b>{entry.title}</b>
                <small>{entry.end > entry.start ? TEXT.span(weekClock(entry.start), weekClock(entry.end)) : TEXT.from(weekClock(entry.start))}</small>
                {tag && <span className={tag.tone}>{tag.label}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
