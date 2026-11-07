// components/apps/PortalApp.js: the E-Portal, inside the phone (see components/Phone.js). Reads /api/portal, which is built from the player's own saved exam results.
// Laid out for the phone's ~340px page: a summary card, then stacked rows (no wide tables, nothing scrolls sideways).
"use client";
import { useState } from "react";
import LoadError from "@/components/LoadError";
import { Icon } from "@/components/Icon";
import { useResource } from "@/lib/gameStore";
import "./portal-app.css";

const g2 = (n) => (n == null ? "–" : Number(n).toFixed(2));

/** CGPA as a ring: the arc fills in proportion to the grade point scale (5.00 = full). */
function Ring({ value, scale }) {
  const R = 34, C = 2 * Math.PI * R, v = Number(value);
  const pct = Number.isFinite(v) && scale > 0 ? Math.max(0, Math.min(1, v / scale)) : 0;
  return (
    <div className="ep-ring" role="img" aria-label={`Cumulative GPA ${g2(value)} out of ${Number(scale).toFixed(2)}`}>
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={R} className="ep-ring-bg" />
        <circle cx="42" cy="42" r={R} className="ep-ring-fg" strokeDasharray={`${(C * pct).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 42 42)" />
      </svg>
      <b className="num">{g2(value)}</b>
    </div>
  );
}

function Grade({ g }) {
  return <i className="ep-grade" data-g={g}>{g}</i>;
}

function Semester({ s }) {
  return (
    <section className="ep-card" aria-label={`${s.name}, week ${s.week}`}>
      <header className="ep-card-h">
        <div><h4>{s.name}</h4><small>Examined in week {s.week}</small></div>
        <div className="ep-gpa"><b className="num">{g2(s.gpa)}</b><small>GPA</small></div>
      </header>
      {s.missed && <p className="ep-flag">Examination not sat. Every course is recorded as 0.</p>}
      {s.malpractice && <p className="ep-flag">Examination malpractice: the semester score was capped.</p>}
      {s.courses.length ? (
        <ul className="ep-rows">
          {s.courses.map((c) => (
            <li key={c.code} className="ep-row">
              <Grade g={c.grade} />
              <div className="ep-row-t"><b>{c.title}</b><small>{c.code} · {c.units} unit{c.units === 1 ? "" : "s"}</small></div>
              <div className="ep-row-v"><b className="num">{c.score}</b><small>score</small></div>
            </li>
          ))}
        </ul>
      ) : <p className="ep-note">No course list is on record for this semester.</p>}
      <footer className="ep-foot">
        <span><b className="num">{s.score}</b>Mean score</span>
        <span><b className="num">{s.unitsEarned}/{s.units}</b>Units earned</span>
        <span><b className="num">{g2(s.cgpaAfter)}</b>CGPA after</span>
      </footer>
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
        <span className="ep-seal" aria-hidden="true"><Icon name="library" size={20} weight="fill" /></span>
        <div><b>{st.name}</b><small>{st.matric} · {st.faculty}</small></div>
        <span className="ep-level num">{st.graduated ? "Graduate" : `${st.level}L`}</span>
      </section>

      <section className="ep-hero" aria-label="Academic summary">
        <div className="ep-hero-top">
          <Ring value={sm.cgpa} scale={sm.scale} />
          <div className="ep-hero-t">
            <small>Cumulative GPA</small>
            <b className="num">{g2(sm.cgpa)}<span> / {sm.scale.toFixed(2)}</span></b>
            <span>Last semester <b className="num">{g2(sm.gpa)}</b></span>
            <span>{sm.semesters ? `${sm.semesters} semester${sm.semesters === 1 ? "" : "s"} on record` : "No semester yet"}</span>
          </div>
        </div>
        <div className="ep-stats">
          <span><b className="num">{sm.totalUnits}</b>Units taken</span>
          <span><b className="num">{sm.unitsEarned}</b>Units earned</span>
          <span><b className="num">{sm.strikes}/5</b>Strikes</span>
        </div>
      </section>
      <p className="ep-standing" data-tone={sm.tone}><b>{sm.standing}</b><span>{sm.status}</span></p>

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

      {tab === "registration" && (cur ? (
        <section className="ep-card" aria-label="Current registration">
          <header className="ep-card-h">
            <div><h4>{cur.level} Level registration</h4><small>Week {cur.week} of {cur.sessionWeeks} · {cur.weeksLeft} week{cur.weeksLeft === 1 ? "" : "s"} left</small></div>
            <div className="ep-gpa"><b className="num">{cur.sat ? "Sat" : `Wk ${cur.nextExamWeek}`}</b><small>{cur.sat ? "this week" : "next exam"}</small></div>
          </header>
          <ul className="ep-rows">
            {cur.courses.map((c) => (
              <li key={c.code} className="ep-row ep-reg">
                <div className="ep-row-t"><b>{c.title}</b><small>{c.code} · {c.units} unit{c.units === 1 ? "" : "s"} · {c.lecturer}</small>
                  <span className="ep-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, c.attendancePct))}%` }} /></span>
                </div>
                <div className="ep-row-v"><b className="num">{c.attendancePct}%</b><small>attended</small></div>
              </li>
            ))}
          </ul>
          <footer className="ep-foot ep-foot-1"><span><b className="num">{cur.courses.reduce((t, c) => t + c.units, 0)}</b>Units registered</span></footer>
        </section>
      ) : <div className="ep-empty"><b>Graduated</b><p>You have completed your degree. There is nothing left to register.</p></div>)}

      {tab === "about" && (
        <section className="ep-card" aria-label="Grading system">
          <header className="ep-card-h"><div><h4>Grading system</h4><small>5-point scale</small></div></header>
          <ul className="ep-rows">
            {[["70 – 100", "A", 5], ["60 – 69", "B", 4], ["50 – 59", "C", 3], ["45 – 49", "D", 2], ["40 – 44", "E", 1], ["0 – 39", "F", 0]].map(([r, l, p]) => (
              <li key={l} className="ep-row"><Grade g={l} /><div className="ep-row-t"><b>{r}</b><small>Score range</small></div><div className="ep-row-v"><b className="num">{p}</b><small>point{p === 1 ? "" : "s"}</small></div></li>
            ))}
          </ul>
          <p className="ep-note">Each semester is one examination. Its GPA is the grade point of your mean score across that semester&rsquo;s four courses, and your CGPA is the average of all your semester GPAs. Credit units show the weight of each course and how many you earned (a score of 40 or more).</p>
          <p className="ep-note">Degree classes: First Class 4.50+, Second Class Upper 3.50+, Second Class Lower 2.40+, Third Class 1.50+, Pass 1.00+.</p>
        </section>
      )}
    </div>
  );
}