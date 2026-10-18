// components/apps/CoursesApp.js
// components/apps/CoursesApp.js: lives inside the phone (see components/Phone.js)
"use client";
import { useState } from "react";
import LoadError from "@/components/LoadError";
import LectureFight from "@/components/LectureFight";
import { confirmAction } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { call } from "@/lib/client";
import { game, run, bump, useResource } from "@/lib/gameStore";

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
  // The courses are kept between visits, so reopening this screen is instant and it refreshes quietly behind you.
  const { d, store, load, loadFailed, router } = useResource("/api/courses");
  const [fight, setFight] = useState(null); // the course whose lecturer you are about to fight

  async function startFight(c) {
    if (d.energy < 20) return toast.error("You are too tired to fight. Rest first.");
    const ok = await confirmAction({
      title: `Fight ${c.lecturer.name}?`,
      message: `Beat them and there is an 80% chance the N-QRS van comes for you: they seize 30% of your cash, you get a strike, and you are driven to Floor O (N-QRS Custody), where you serve your whole sentence. Lose and you get hurt. Costs 20 energy. Once a week.`,
      confirmLabel: "Fight",
      tone: "danger",
    });
    if (ok) setFight(c);
  }

  // Attending or studying shows at once (the meter, the "done this week" label, your energy) and is undone if the server refuses.
  function act(action, code) {
    const cost = d.costs[action],
      c = d.courses.find((x) => x.code === code);
    return run({
      key: `course:${action}:${code}`,
      router,
      ok:
        action === "attend"
          ? `You sat through ${c.lecturer.name}'s lecture in ${code}.`
          : `You studied ${code}.`,
      request: () =>
        call("/api/courses", { action, code, requestId: crypto.randomUUID() }),
      effects: [
        {
          store,
          patch: (x) => ({
            ...x,
            energy: Math.max(0, x.energy - cost),
            courses: x.courses.map((y) =>
              y.code !== code
                ? y
                : action === "attend"
                  ? {
                      ...y,
                      attended: y.attended + 1,
                      prep: Math.min(100, y.prep + 3),
                      attendedThisWeek: true,
                      attendancePct: Math.round(
                        Math.min(1, (y.attended + 1) / Math.max(1, x.weeksElapsed)) * 100,
                      ),
                    }
                  : {
                      ...y,
                      prep: Math.min(100, y.prep + 10),
                      studiedThisWeek: true,
                    },
            ),
          }),
        },
        {
          store: game,
          patch: bump(
            action === "study" ? { energy: -cost, happiness: -2 } : { energy: -cost },
          ),
        },
      ],
    });
  }
  if (!d)
    return loadFailed ? (
      <LoadError onRetry={load} />
    ) : (
      <p className="mut">Loading...</p>
    );
  return (
    <>
      <div className="top">
        <h2>Courses</h2>
        <a href="/home">
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
          Next exam: week {d.nextExamWeek}. Attend lectures and study so
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
          <Meter label="Attendance" pct={c.attendancePct} color="var(--green-text)" />
          <Meter label="Preparation" pct={c.prep} color="var(--gold-text)" />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              disabled={c.attendedThisWeek || d.energy < d.costs.attend}
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
              disabled={c.studiedThisWeek || d.energy < d.costs.study}
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
          <button type="button" style={{ marginTop: 8, width: "100%" }} onClick={() => startFight(c)}>
            Fight {c.lecturer.name}
            <br />
            <span className="mut">20 energy. Risky: N-QRS may come.</span>
          </button>
        </div>
      ))}
      {fight && <LectureFight course={fight} onClose={() => setFight(null)} />}
      <p className="mut">
        Lecture slots are for flavour: you can attend any time during the game
        week. Lecturers are fictional, and the courses are game content, not the
        official OAU curriculum.
      </p>
    </>
  );
}