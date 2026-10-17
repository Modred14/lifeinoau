import { PiWarningFill } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";
import type { Timetable } from "./lock-notification";
import { CourseHandout } from "./school-handout";
import { useAdmin, type Admin } from "./school-portal";

type CourseItem = Timetable["courses"][number];

const NOT_HELD = "No class counted yet";
const COUNT_NOTE = "A class counts once you were on campus while it held. Lecturer no show does not count.";

function ruleNote(rule: number, penalty: number): string {
  const base = `Sign at least ${rule}% of the classes in each course. Any course under ${rule}% takes marks off your daily test.`;
  return penalty > 0 ? `${base} Right now you lose ${penalty} marks.` : base;
}

function CourseRow({ course, rule, view, admin }: { course: CourseItem; rule: number; view: CampusView; admin: Admin }) {
  return (
    <li className="ph-list-row ph-course">
      <span className="ph-row">
        <b>
          {course.code} · {course.units} units
        </b>
        {course.held > 0 && <b className={course.low ? "ph-price ph-low" : "ph-price"}>{course.percent}%</b>}
      </span>
      <span>{course.title}</span>
      <small>
        {course.lecturer} · {course.temperament}
      </small>
      <small>{course.held > 0 ? `Signed ${course.signed} of ${course.held} classes` : NOT_HELD}</small>
      {course.held > 0 && (
        <span className={course.low ? "ph-meter ph-meter-low" : "ph-meter"} aria-hidden="true">
          <span style={{ width: `${course.percent}%` }} />
        </span>
      )}
      {course.low && (
        <span className="ph-tag ph-tag-bad">
          <PiWarningFill aria-hidden="true" /> Under {rule}%. Attend more classes
        </span>
      )}
      <CourseHandout view={view} admin={admin} code={course.code} />
    </li>
  );
}

export function SchoolCourses({ timetable, view }: { timetable: Timetable; view: CampusView }) {
  const admin = useAdmin(view);
  return (
    <>
      <p className="ph-note">{ruleNote(timetable.rule, timetable.penalty)}</p>
      <ul className="ph-list">
        {timetable.courses.map((course) => (
          <CourseRow key={course.code} course={course} rule={timetable.rule} view={view} admin={admin} />
        ))}
      </ul>
      <p className="ph-note">{COUNT_NOTE}</p>
    </>
  );
}
