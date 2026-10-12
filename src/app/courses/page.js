// src/app/courses/page.js
"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";

function Meter({ label, pct, color }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div className="top">
        <span className="mut">{label}</span>
        <span className="mut">{pct}%</span>
      </div>
      <div
        className="bar"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: pct + "%", background: color }} />
      </div>
    </div>
  );
}

export default function Courses() {
  const router = useRouter(),
    [d, setD] = useState(null),
    [loadFailed, setLoadFailed] = useState(false),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await call("/api/courses");
    if (r.status === 401) return loggedOut(router);
    if (r.failed) {
      notifyError(r);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setD(r);
  }, [router]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(action, code) {
    if (busy) return;
    setBusy(true);
    const r = await call("/api/courses", {
      action,
      code,
      requestId: crypto.randomUUID(),
    });
    setBusy(false);
    if (r.status === 401) return loggedOut(router);
    if (r.failed) notifyError(r);
    else if (r.duplicate) toast.info("Already done.");
    else toast.success(r.note ?? "Done.");
    load();
  }
  if (!d)
    return loadFailed ? (
      <div className="card">
        <p className="mut">This page didn&apos;t load.</p>
        <button onClick={load}>Try again</button>
      </div>
    ) : (
      <p className="mut">Loading...</p>
    );
  return (
    <>
      <div className="top">
        <h2>Courses</h2>
        <a href="/play">
          <button>Back to game</button>
        </a>
      </div>
      <p className="mut">
        {d.faculty} · {d.level}L · week {d.weeksElapsed} of {d.sessionWeeks}{" "}
        this session · energy {d.energy}
      </p>
      {d.examToday ? (
        <p>
          <b>Exam today.</b> Sit it on the game screen before the week ends.
          Your attendance and preparation so far decide your score.
        </p>
      ) : (
        <p className="mut">
          Next exam: game week {d.nextExamWeek}. Attend lectures and study so
          you are ready.
        </p>
      )}
      {d.courses.map((c) => (
        <div className="card" key={c.code}>
          <div className="top">
            <h2>{c.code}</h2>
            <span className="mut">lecture slot: {c.slot}</span>
          </div>
          <p>
            <b>{c.title}</b>
            <br />
            <span className="mut">
              {c.lecturer.name} · {c.lecturer.reputation} · difficulty{" "}
              {c.difficulty}
            </span>
          </p>
          <p className="mut">
            {c.lecturer.personality}. {c.lecturer.style}.
          </p>
          <Meter label="Attendance" pct={c.attendancePct} color="var(--ok)" />
          <Meter label="Preparation" pct={c.prep} color="var(--acc)" />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              disabled={busy || c.attendedThisWeek || d.energy < d.costs.attend}
              onClick={() => act("attend", c.code)}
            >
              Attend lecture
              <br />
              <span className="mut">
                {c.attendedThisWeek
                  ? "done this week"
                  : `${d.costs.attend} energy`}
              </span>
            </button>
            <button
              disabled={busy || c.studiedThisWeek || d.energy < d.costs.study}
              onClick={() => act("study", c.code)}
            >
              Study
              <br />
              <span className="mut">
                {c.studiedThisWeek
                  ? "done this week"
                  : `${d.costs.study} energy`}
              </span>
            </button>
          </div>
        </div>
      ))}
      <p className="mut">
        Lecture slots are for flavour: you can attend any time during the game
        week. Lecturers are fictional, and the courses are game content, not the
        official OAU curriculum.
      </p>
    </>
  );
}
