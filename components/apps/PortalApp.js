// components/apps/PortalApp.js: the E-Portal, inside the phone (see components/Phone.js). Reads /api/portal, which is built from the player's own saved exam results.
// Laid out for the handset: one column, no tables and no sideways scrolling. Every course is a row (grade badge, code + title, score + units).
"use client";
import { useState } from "react";
import LoadError from "@/components/LoadError";
import { Icon } from "@/components/Icon";
import { useResource } from "@/lib/gameStore";
import "./portal-app.css";

const g2 = (n) => (n == null ? "–" : Number(n).toFixed(2));
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const GRADES = [["70 – 100", "A", 5, "Excellent"], ["60 – 69", "B", 4, "Very good"], ["50 – 59", "C", 3, "Good"], ["45 – 49", "D", 2, "Fair"], ["40 – 44", "E", 1, "Pass"], ["0 – 39", "F", 0, "Fail"]];

function Stat({ label, value }) {
  return <div className="ep-stat"><b className="num">{value}</b><span>{label}</span></div>;
}

/** One course in a semester: grade badge, code and title, then the score and the credit units. */
function ResultRow({ c }) {
  return (
    <li className="ep-row">
      <i className="ep-grade" data-g={c.grade} aria-label={`Grade ${c.grade}`}>{c.grade}</i>
      <div className="ep-main"><b className="code">{c.code}</b><span>{c.title}</span></div>
      <div className="ep-end"><b className="num">{c.score}</b><small>{plural(c.units, "unit")}</small></div>
    </li>
  );
}

function Semester({ s }) {
  return (
    <section className="ep-sem" aria-label={`${s.name}, week ${s.week}`}>
      <header>
        <div><h4>{s.name}</h4><small>Examined in week {s.week}</small></div>
        <div className="ep-sem-gpa"><b className="num">{g2(s.gpa)}</b><small>GPA</small></div>
      </header>
      {s.missed && <p className="ep-flag" data-tone="bad">Examination not sat. Every course is recorded as 0.</p>}
      {s.malpractice && <p className="ep-flag" data-tone="bad">Examination malpractice: the semester score was capped.</p>}
      {s.courses.length ? <ul className="ep-list">{s.courses.map((c) => <ResultRow key={c.code} c={c} />)}</ul> : <p className="ep-note">No course list is on record for this semester.</p>}
      <footer>
        <span><b className="num">{s.score}</b>Mean score</span>
        <span><b className="num">{s.unitsEarned}/{s.units}</b>Units earned</span>
        <span><b className="num">{g2(s.cgpaAfter)}</b>CGPA after</span>
      </footer>
    </section>
  );
}

function Registration({ cur }) {
  if (!cur) return <div className="ep-empty"><b>Graduated</b><p>You have completed your degree. There is nothing left to register.</p></div>;
  const pct = Math.max(0, Math.min(100, Math.round((cur.week / cur.sessionWeeks) * 100)));
  const units = cur.courses.reduce((t, c) => t + c.units, 0);
  return (
    <section className="ep-sem" aria-label="Current registration">
      <header>
        <div><h4>{cur.level} Level registration</h4><small>Week {cur.week} of {cur.sessionWeeks} · {plural(cur.weeksLeft, "week")} left</small></div>
        <div className="ep-sem-gpa"><b className="num">{cur.sat ? "Sat" : `Wk ${cur.nextExamWeek}`}</b><small>{cur.sat ? "this week" : "next exam"}</small></div>
      </header>
      <div className="ep-track" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
      <ul className="ep-list">
        {cur.courses.map((c) => (
          <li className="ep-row" key={c.code}>
            <i className="ep-grade ep-pct num" aria-hidden="true">{c.attendancePct}%</i>
            <div className="ep-main"><b className="code">{c.code}</b><span>{c.title}</span><small className="ep-lect">{c.lecturer}</small></div>
            <div className="ep-end"><b className="num">{c.units}</b><small>{c.units === 1 ? "unit" : "units"}</small></div>
          </li>
        ))}
      </ul>
      <footer><span><b className="num">{units}</b>Units registered</span><span><b className="num">{cur.courses.length}</b>Courses</span></footer>
    </section>
  );
}

function Grading() {
  return (
    <section className="ep-sem" aria-label="Grading system">
      <header><div><h4>Grading system</h4><small>5-point scale</small></div></header>
      <ul className="ep-list">
        {GRADES.map(([range, l, p, word]) => (
          <li className="ep-row" key={l}>
            <i className="ep-grade" data-g={l} aria-hidden="true">{l}</i>
            <div className="ep-main"><b>{range}</b><span>{word}</span></div>
            <div className="ep-end"><b className="num">{p}</b><small>{p === 1 ? "point" : "points"}</small></div>
          </li>
        ))}
      </ul>
      <p className="ep-note">Each semester is one examination. Its GPA is the grade point of your mean score across that semester&rsquo;s four courses, and your CGPA is the average of all your semester GPAs. Credit units show the weight of each course and how many you earned (a score of 40 or more).</p>
      <p className="ep-note">Degree classes: First Class 4.50+, Second Class Upper 3.50+, Second Class Lower 2.40+, Third Class 1.50+, Pass 1.00+.</p>
    </section>
  );
}

export default function PortalApp() {
  const { d, load, loadFailed } = useResource("/api/portal");
  const [tab, setTab] = useState("results");
  const [pick, setPick] = useState(0);
  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <p className="mut">Loading your records…</p>;
  const { student: st, summary: sm, current: cur, sessions } = d;
  const s = sessions[Math.min(pick, sessions.length - 1)];
  return (
    <div className="ep">
      <section className="ep-id" aria-label="Student">
        <span className="ep-seal" aria-hidden="true"><Icon name="library" size={22} weight="fill" /></span>
        <div><b>{st.name}</b><small>{st.matric}</small><small>{st.faculty}</small></div>
        <span className="ep-level num">{st.graduated ? "Graduate" : `${st.level}L`}</span>
      </section>

      <section className="ep-hero" aria-label="Academic summary">
        <div className="ep-cgpa"><small>Cumulative GPA</small><b className="num">{g2(sm.cgpa)}</b><span>out of {sm.scale.toFixed(2)}</span></div>
        <div className="ep-cgpa"><small>Last semester GPA</small><b className="num">{g2(sm.gpa)}</b><span>{sm.semesters ? plural(sm.semesters, "semester") + " on record" : "No semester yet"}</span></div>
      </section>
      <p className="ep-standing" data-tone={sm.tone}><b>{sm.standing}</b><span>{sm.status}</span></p>
      <div className="ep-stats">
        <Stat label="Units taken" value={sm.totalUnits} />
        <Stat label="Units earned" value={sm.unitsEarned} />
        <Stat label="Strikes" value={`${sm.strikes}/5`} />
      </div>

      <div role="tablist" aria-label="E-Portal sections">
        {[["results", "Results"], ["registration", "Registration"], ["about", "Grading"]].map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{n}</button>
        ))}
      </div>

      {tab === "results" && (!s ? (
        <div className="ep-empty"><b>No results yet</b><p>Your results appear here after your first examination{cur ? `, in week ${cur.nextExamWeek}` : ""}. Exams are sat in person at your faculty building or a lecture theatre.</p></div>
      ) : (
        <>
          <div className="ep-chips" role="tablist" aria-label="Academic sessions">
            {sessions.map((x, i) => (
              <button key={x.no} type="button" role="tab" aria-selected={i === pick} onClick={() => setPick(i)}>{x.level}L{x.attempt > 1 ? ` · attempt ${x.attempt}` : ""}</button>
            ))}
          </div>
          <div className="ep-sess">
            <h3>{s.level} Level · session {s.no}</h3>
            <p>Session GPA <b className="num">{g2(s.gpa)}</b> · units earned <b className="num">{s.unitsEarned}/{s.units}</b>{s.complete ? "" : " · in progress"}</p>
          </div>
          {s.semesters.map((x) => <Semester key={x.no} s={x} />)}
          {sm.archived > 0 && <p className="ep-note">{sm.archived} result{sm.archived === 1 ? "" : "s"} from before your restart are archived and do not count towards your CGPA.</p>}
        </>
      ))}

      {tab === "registration" && <Registration cur={cur} />}
      {tab === "about" && <Grading />}
    </div>
  );
}