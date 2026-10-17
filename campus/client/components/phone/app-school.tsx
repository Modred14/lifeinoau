import { useMemo, useState } from "react";
import type { CampusView } from "@campus/game/CampusView";
import type { Timetable } from "./lock-notification";
import { SchoolCalendar } from "./school-calendar";
import { SchoolCourses } from "./school-courses";
import { SchoolPortal } from "./school-portal";
import { SchoolResults } from "./school-results";
import { SchoolToday, SchoolWeek } from "./school-timetable";

const MINUTES_PER_DAY = 1440;
const TABS = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "calendar", label: "Calendar" },
  { id: "courses", label: "Courses" },
  { id: "portal", label: "Portal" },
  { id: "results", label: "Results" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const TEST_NOTE = "Evening test: Wed to Fri 16:00 at the 1000 Seater. Weekly assessment: Sat 10:00. Read in class and the library. Late night TOC reading counts 1.5×.";

export function AppSchool({ view, timetable, onClose }: { view: CampusView; timetable: Timetable; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("today");
  const ac = useMemo(() => view.getAcademics(), [view]);
  const go = (target: { x: number; y: number }, name: string) => {
    view.goTo(target, name);
    onClose();
  };
  const stats = [
    { value: ac.exams ? ac.cgpa.toFixed(2) : "None yet", label: `OAU CGPA · ${ac.degree}` },
    { value: ac.lastGrade || "None yet", label: `Latest campus assessment · ${ac.exams} OAU exams` },
    { value: String(ac.weekStudy), label: "Study pts this week" },
    { value: String(ac.weekAttended), label: "Classes signed this week" },
  ];
  return (
    <>
      <dl className="ph-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="ph-card">
            <dd>{stat.value}</dd>
            <dt>{stat.label}</dt>
          </div>
        ))}
      </dl>
      <p className="ph-note">
        {TEST_NOTE}
        {timetable.penalty > 0 && ` ⚠️ Low attendance: minus ${timetable.penalty} marks in the next paper.`}
        {ac.malpractice > 0 && ` ⚠️ Malpractice cases: ${ac.malpractice}.`}
        {ac.rusticatedFor > 0 && ` ⚖️ Rusticated for ${Math.ceil(ac.rusticatedFor / MINUTES_PER_DAY)} more day(s).`}
      </p>
      <div className="ph-tabs" role="tablist" aria-label="School sections">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" className="ph-tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {tab === "today" && <SchoolToday timetable={timetable} go={go} />}
      {tab === "week" && <SchoolWeek timetable={timetable} />}
      {tab === "calendar" && <SchoolCalendar semester={view.getSemester()} />}
      {tab === "courses" && <SchoolCourses timetable={timetable} view={view} />}
      {tab === "portal" && <SchoolPortal view={view} go={go} />}
      {tab === "results" && <SchoolResults view={view} go={go} />}
    </>
  );
}
