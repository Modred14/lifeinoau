"use client";

import type { CampusView } from "@campus/game/CampusView";
import { hhmm } from "./format";
import { useAdmin, type Admin } from "./school-portal";

type Slip = Admin["slip"];
type Go = (target: { x: number; y: number }, name: string) => void;

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TEXT = {
  thisWeek: "Result slip · this semester",
  lastWeek: "Result slip · last semester",
  none: "No result yet this semester. Tests are Wed to Fri 16:00 and the exam is Sat 10:00, at the 1000 Seater.",
  today: (course: string) => `Today's test: ${course}.`,
  total: (units: number, gpa: string) => `${units} units · GPA ${gpa}`,
  carried: (count: number) => `${count} carry-over${count === 1 ? "" : "s"}`,
  carryHeading: "Carry-over classes this semester",
  carryNote: "Sit in the class like any other. It counts for that course's attendance.",
  next: (codes: string) => `Next semester you get one extra class each for: ${codes}.`,
  pass: "Pass",
};

function SlipTable({ slip, heading }: { slip: Slip; heading: string }) {
  return (
    <section>
      <h3 className="ph-heading">{heading}</h3>
      <ul className="ph-list">
        {slip.rows.map((row) => (
          <li key={`${row.weekday}-${row.code}`} className="ph-list-row">
            <span className="ph-time">{DAY_SHORT[row.weekday]}</span>
            <span className="ph-list-text">
              <b>
                {row.code} · {row.units} units
              </b>
              <small>{row.title}</small>
              <span className={row.remark === TEXT.pass ? "ph-tag" : "ph-tag ph-tag-bad"}>{row.remark}</span>
            </span>
            <b className={row.remark === TEXT.pass ? "ph-price" : "ph-price ph-low"}>
              {row.score}% · {row.grade}
            </b>
          </li>
        ))}
      </ul>
      <p className="ph-note">
        {TEXT.total(slip.units, slip.gpa.toFixed(2))}
        {slip.carried > 0 && ` · ${TEXT.carried(slip.carried)}`}
      </p>
    </section>
  );
}

export function SchoolResults({ view, go }: { view: CampusView; go: Go }) {
  const admin = useAdmin(view);
  return (
    <>
      {admin.todayTest && <p className="ph-note">{TEXT.today(admin.todayTest)}</p>}
      {admin.slip.rows.length > 0 ? <SlipTable slip={admin.slip} heading={TEXT.thisWeek} /> : <p className="ph-note">{TEXT.none}</p>}
      {admin.carry.length > 0 && (
        <section>
          <h3 className="ph-heading">{TEXT.carryHeading}</h3>
          <ul className="ph-list">
            {admin.carry.map((item) => (
              <li key={item.code} className="ph-list-row">
                <span className="ph-time">{hhmm(item.start)}</span>
                <span className="ph-list-text">
                  <b>
                    {item.code} · {item.day}
                  </b>
                  <small>{item.title}</small>
                  <small>{item.venue}</small>
                </span>
                <button type="button" className="ph-btn" onClick={() => go(item.door, item.venue)} aria-label={`Go to ${item.code} at ${item.venue}`}>
                  Go
                </button>
              </li>
            ))}
          </ul>
          <p className="ph-note">{TEXT.carryNote}</p>
        </section>
      )}
      {admin.nextCarry.length > 0 && <p className="ph-note">{TEXT.next(admin.nextCarry.join(", "))}</p>}
      {admin.lastSlip.rows.length > 0 && <SlipTable slip={admin.lastSlip} heading={TEXT.lastWeek} />}
    </>
  );
}
