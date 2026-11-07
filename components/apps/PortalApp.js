// components/apps/PortalApp.js: the E-Portal, inside the phone (see components/Phone.js). Reads /api/portal, which is built from the player's own saved exam results.
"use client";
import { useState } from "react";
import LoadError from "@/components/LoadError";
import { Icon } from "@/components/Icon";
import { useResource } from "@/lib/gameStore";
import "./portal-app.css";

const g2 = (n) => (n == null ? "–" : Number(n).toFixed(2));

function Stat({ label, value }) {
  return <div className="ep-stat"><b className="num">{value}</b><span>{label}</span></div>;
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
      {s.courses.length ? (
        <div className="ep-scroll">
          <table className="ep-table">
            <thead><tr><th scope="col">Code</th><th scope="col">Course title</th><th scope="col" className="r">CU</th><th scope="col" className="r">Score</th><th scope="col" className="r">Grade</th></tr></thead>
            <tbody>
              {s.courses.map((c) => (
                <tr key={c.code}>
                  <td className="code">{c.code}</td><td>{c.title}</td><td className="r num">{c.units}</td><td className="r num">{c.score}</td>
                  <td className="r"><i className="ep-grade" data-g={c.grade}>{c.grade}</i></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="ep-note">No course list is on record for this semester.</p>}
      <footer>
        <span>Mean score <b className="num">{s.score}</b></span>
        <span>Units <b className="num">{s.unitsEarned}/{s.units}</b></span>
        <span>CGPA after <b className="num">{g2(s.cgpaAfter)}</b></span>
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
        <span className="ep-seal" aria-hidden="true"><Icon name="library" size={22} weight="fill" /></span>
        <div><b>{st.name}</b><small>{st.matric} · {st.faculty}</small></div>
        <span className="ep-level num">{st.graduated ? "Graduate" : `${st.level}L`}</span>
      </section>

      <section className="ep-hero" aria-label="Academic summary">
        <div className="ep-cgpa"><small>Cumulative GPA</small><b className="num">{g2(sm.cgpa)}</b><span>out of {sm.scale.toFixed(2)}</span></div>
        <div className="ep-cgpa"><small>Last semester GPA</small><b className="num">{g2(sm.gpa)}</b><span>{sm.semesters ? `${sm.semesters} semester${sm.semesters === 1 ? "" : "s"} on record` : "No semester yet"}</span></div>
      </section>
      <p className="ep-standing" data-tone={sm.tone}><b>{sm.standing}</b><span>{sm.status}</span></p>
      <div className="ep-stats">
        <Stat label="Credit units taken" value={sm.totalUnits} />
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

      {tab === "registration" && (cur ? (
        <section className="ep-sem" aria-label="Current registration">
          <header><div><h4>{cur.level} Level registration</h4><small>Week {cur.week} of {cur.sessionWeeks} · {cur.weeksLeft} week{cur.weeksLeft === 1 ? "" : "s"} left</small></div>
            <div className="ep-sem-gpa"><b className="num">{cur.sat ? "Sat" : `Wk ${cur.nextExamWeek}`}</b><small>{cur.sat ? "this week" : "next exam"}</small></div></header>
          <div className="ep-scroll">
            <table className="ep-table">
              <thead><tr><th scope="col">Code</th><th scope="col">Course title</th><th scope="col" className="r">CU</th><th scope="col" className="r">Attend.</th></tr></thead>
              <tbody>{cur.courses.map((c) => <tr key={c.code}><td className="code">{c.code}</td><td>{c.title}<small className="ep-lect">{c.lecturer}</small></td><td className="r num">{c.units}</td><td className="r num">{c.attendancePct}%</td></tr>)}</tbody>
            </table>
          </div>
          <footer><span>Units registered <b className="num">{cur.courses.reduce((t, c) => t + c.units, 0)}</b></span></footer>
        </section>
      ) : <div className="ep-empty"><b>Graduated</b><p>You have completed your degree. There is nothing left to register.</p></div>)}

      {tab === "about" && (
        <section className="ep-sem" aria-label="Grading system">
          <header><div><h4>Grading system</h4><small>5-point scale</small></div></header>
          <div className="ep-scroll"><table className="ep-table"><thead><tr><th scope="col">Score</th><th scope="col">Grade</th><th scope="col" className="r">Point</th></tr></thead>
            <tbody>{[["70 – 100", "A", 5], ["60 – 69", "B", 4], ["50 – 59", "C", 3], ["45 – 49", "D", 2], ["40 – 44", "E", 1], ["0 – 39", "F", 0]].map(([r, l, p]) => <tr key={l}><td>{r}</td><td><i className="ep-grade" data-g={l}>{l}</i></td><td className="r num">{p}</td></tr>)}</tbody></table></div>
          <p className="ep-note">Each semester is one examination. Its GPA is the grade point of your mean score across that semester&rsquo;s four courses, and your CGPA is the average of all your semester GPAs. Credit units show the weight of each course and how many you earned (a score of 40 or more).</p>
          <p className="ep-note">Degree classes: First Class 4.50+, Second Class Upper 3.50+, Second Class Lower 2.40+, Third Class 1.50+, Pass 1.00+.</p>
        </section>
      )}
    </div>
  );
}
