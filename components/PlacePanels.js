// components/PlacePanels.js
// The things you do INSIDE a building, opened from an interaction point (a "hub") in the 3D interior:
//   HustlePanel   the Oduduwa Hall event crew (stewards' desk) and the SUB backstairs runs (back stairwell)
//   FacultyPanel  your faculty: the entrance desk, the lecture hall, the test hall and the examination hall
// Every number and every yes/no here comes from the server (lib/hustleService.js, lib/facultyService.js, lib/courseService.js, lib/gameService.js).
// The server checks where you are, the game clock, your energy and what you are already doing; this file only shows its answer.
"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira } from "@/lib/client";
import { toast } from "@/lib/toast";
import { game } from "@/lib/gameStore";
import { confirmAction } from "@/lib/confirm";
import { serverTime } from "@/lib/serverClock";
import { waitText } from "@/lib/engine";
import { Icon } from "./Icon";

const rid = () => crypto.randomUUID();
const k = (n) => "₦" + Number(n).toLocaleString("en-NG");

/** A small shell shared by every panel: title, a close button, and a place for the server's answer. */
function Sheet({ icon, title, sub, onClose, children }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="pp" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pp-card">
        <button type="button" className="pp-x" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>
        <h2><Icon name={icon} size={20} /> {title}</h2>
        {sub && <p className="mut pp-sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

/** Load a GET endpoint and keep it fresh; `reload` fetches again. */
function useServer(path) {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const reload = useCallback(async () => {
    const r = await call(path);
    if (r.failed) setErr(r.error || "Could not load. Try again."); else { setErr(null); setD(r); }
    return r;
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { d, err, reload };
}

/** A one-second clock on the SERVER's time, so two devices agree on every countdown. */
function useNow(active = true) {
  const [now, setNow] = useState(() => serverTime());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(serverTime()), 1000); return () => clearInterval(t); }, [active]);
  return now;
}

/* ------------------------------------------------------------------ the hustles */

export function HustlePanel({ kind, onClose }) {
  const router = useRouter(), { d, err, reload } = useServer(`/api/hustle?kind=${kind}`), [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  const now = useNow(!!d?.run), run = d?.run;
  const act = async (action) => {
    setBusy(true);
    const r = await call("/api/hustle", { action, kind, requestId: rid() });
    setBusy(false);
    if (r.failed) { toast.error(r.error || "That did not work."); await reload(); return r; }
    game.refresh?.();
    if (action === "finish") {
      setResult(r);
      if (r.caught) { toast.error(`N-QRS HAS CAUGHT YOU. They seized ${naira(r.seizedKobo)} and you are in Floor O (N-QRS Custody). Bail starts at ${naira(r.billKobo)}.`, { duration: 8000 }); setTimeout(() => router.push("/home"), 1800); }
      else if (r.abandoned) toast.info(r.note);
      else toast.success(`${d.kind === "crew" ? "The crowd has gone home." : "The package moved."} You earned ${naira(r.earnedKobo)}.`, { sound: "coin" });
    }
    await reload();
    return r;
  };
  const start = async () => {
    if (d.kind === "backstairs" && !(await confirmAction({
      title: "Backstairs run: VERY RISKY",
      message: `Either you make ${k(d.payMin)} to ${k(d.payMax)}, or N-QRS catches you at the end of the run, seizes 30% of your cash, and you serve time inside Floor O (N-QRS Custody). Patrol risk right now: ${d.risk}. Once a day. If you walk away before it is done you get nothing.`,
      confirmLabel: "Take the risk", tone: "danger" }))) return;
    act("start");
  };
  const left = run ? Math.max(0, run.endsAt - now) : 0, pct = run ? Math.min(100, Math.round(((now - run.startedAt) / (run.endsAt - run.startedAt)) * 100)) : 0;
  const crew = kind === "crew";
  return (
    <Sheet icon={crew ? "hustle" : "dice"} title={d?.name ?? (crew ? "Oduduwa Hall event crew" : "Backstairs runs")} sub={d ? `${d.desk} · ${d.where}` : undefined} onClose={onClose}>
      {!d ? <p className="mut">{err ?? "Looking around…"}</p> : (
        <>
          <p>{d.blurb}</p>
          <ul className="pp-facts">
            <li><span>Pay</span><b>{k(d.payMin)} to {k(d.payMax)}</b></li>
            <li><span>Energy</span><b>{d.energy}</b></li>
            <li><span>Time on site</span><b>{d.durationSeconds} seconds</b></li>
            <li><span>Today</span><b>{d.left} of {d.perDay} left</b></li>
            {d.risk && <li><span>N-QRS patrol</span><b data-risk={d.risk}>{d.risk}</b></li>}
            {d.gapHours && <li><span>Gap between runs</span><b>{d.gapHours} hours</b></li>}
          </ul>
          {run ? (
            <div className="pp-run" role="status" aria-live="polite">
              <b>{crew ? "On shift with the crew" : "The handoff is on"}</b>
              <div className="shift-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + "%" }} /></div>
              <p className="mut">{left > 0 ? `${Math.ceil(left / 1000)}s to go. Stay at ${d.where}: leaving ends the run with no pay.` : "Done. Finish up to see how it went."}</p>
              <div className="row">
                <button type="button" className="go" disabled={busy || left > 0} onClick={() => act("finish")}>{crew ? "Collect your pay" : "See how it went"}</button>
                <button type="button" disabled={busy} onClick={async () => { if (await confirmAction({ title: "Walk away?", message: "No pay, and the energy and today's attempt are already spent.", confirmLabel: "Walk away", cancelLabel: "Stay", tone: "danger" })) act("abandon"); }}>Walk away</button>
              </div>
            </div>
          ) : (
            <>
              {d.blocked && <p className="pp-why">{d.blocked}</p>}
              {!d.blocked && d.energy > 0 && <p className="mut">{crew ? "Pay depends on the role the crew lead gives you." : "The outcome is decided the moment you start. Nothing you do on the way can change it."}</p>}
              <button type="button" className={crew ? "go" : "go pp-danger"} disabled={busy || !!d.blocked} onClick={start}>{crew ? "Join the crew" : "Take the package"}</button>
            </>
          )}
          {result?.caught === false && <p className="pp-ok">Paid {naira(result.earnedKobo)}.</p>}
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ the faculty */

const TITLES = { faculty: "Faculty entrance", lecture: "Lecture hall", test: "Test hall", exam: "Examination hall" };
const ICONS = { faculty: "study", lecture: "study", test: "study", exam: "warn" };

export function FacultyPanel({ mode, onClose }) {
  const router = useRouter(), { d, err, reload } = useServer("/api/faculty"), [busy, setBusy] = useState(false), [note, setNote] = useState(null);
  const refreshAll = async () => { game.refresh?.(); await reload(); };
  const post = async (path, body) => {
    setBusy(true); const r = await call(path, { ...body, requestId: rid() }); setBusy(false);
    if (r.failed) { toast.error(r.error || "That did not work."); await reload(); return null; }
    await refreshAll(); return r;
  };
  const attend = async (c) => { const r = await post("/api/courses", { action: "attend", code: c.code }); if (r) toast.success(`You signed the register for ${c.code}. ${r.note ?? ""}`.trim()); };
  const sitTest = async () => { const r = await post("/api/faculty", { action: "test" }); if (r && !r.duplicate) { setNote(r.note); toast.success(r.note); } };
  const sitExam = async (cheat) => {
    if (cheat && !(await confirmAction({ title: "Try to cheat?", message: "If you are caught your score is crushed, your suspicion rises and there are consequences.", confirmLabel: "Try it", tone: "danger" }))) return;
    const r = await post("/api/exam", { cheat }); if (!r || r.duplicate) return;
    const text = r.caught ? `Caught cheating. Score ${r.score}, grade point ${r.gradePoint}.` : `Score ${r.score}, grade point ${r.gradePoint}.`;
    setNote(text); (r.caught ? toast.error : toast.success)(text);
  };
  return (
    <Sheet icon={ICONS[mode]} title={TITLES[mode]} sub={d ? `${d.home?.name ?? d.faculty} · ${d.weekday} ${d.clock}` : undefined} onClose={onClose}>
      {!d ? <p className="mut">{err ?? "Looking around…"}</p> : (
        <>
          {d.wrongPlace && <p className="pp-why">{d.wrongPlace}</p>}
          {d.atOwn && d.busy && <p className="pp-why">{d.busy}</p>}
          {mode === "faculty" && (
            <>
              <p>{d.atOwn ? `Welcome to ${d.home.name}. This is your faculty.` : `You are enrolled in ${d.faculty}. Your building is ${d.home?.name}.`}</p>
              <p className="mut">Lectures are in the lecture hall on the lecture day, surprise tests wait in the test hall, and exams are sat in the examination hall (08:00 to 18:00). Walk to the doors inside this building.</p>
              <h3>This week</h3>
              <ul className="pp-list">
                {d.courses.map((c) => (
                  <li key={c.code}>
                    <b>{c.code}</b> <span className="mut">{c.slot} · open {c.from}–{c.to}</span>
                    <span data-ok={c.doneThisWeek ? "1" : c.open ? "open" : "0"}>{c.doneThisWeek ? "Attended" : c.open ? "Open now" : "Closed"}</span>
                  </li>
                ))}
              </ul>
              <p className="mut">{d.test ? (d.test.status === "PENDING" ? "A surprise test is waiting for you in the test hall." : d.test.status === "TAKEN" ? `This week's test: ${d.test.score}/20.` : "You missed this week's test.") : "No test announced this week."} {d.exam.week ? (d.exam.sat ? "You have sat this exam." : "It is exam week.") : ""}</p>
            </>
          )}
          {mode === "lecture" && (
            <>
              <p className="mut">Take a seat and sign the register for a lecture that is on right now.</p>
              <ul className="pp-list">
                {d.courses.map((c) => (
                  <li key={c.code}>
                    <span><b>{c.code}</b> {c.title}<br /><span className="mut">{c.slot} · {c.attendancePct}% attendance{c.open ? "" : ` · ${c.why}`}</span></span>
                    <button type="button" className="go" disabled={busy || !d.atOwn || !!d.busy || !c.open || c.doneThisWeek} onClick={() => attend(c)}>{c.doneThisWeek ? "Done" : "Attend"}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {mode === "test" && (
            <>
              {!d.test ? <p className="mut">No test has been announced this week. When a lecturer springs one, it waits for you here.</p>
                : d.test.status === "PENDING" ? (<><p>A surprise test in <b>{d.test.code}</b> is waiting.</p>{d.test.why && <p className="pp-why">{d.test.why}</p>}<button type="button" className="go" disabled={busy || !d.atOwn || !!d.busy || !!d.test.why} onClick={sitTest}>Sit the test</button></>)
                : d.test.status === "TAKEN" ? <p>You sat the {d.test.code} test: <b>{d.test.score}/20</b>.</p> : <p className="pp-why">You missed the {d.test.code} test this week. It counted as 0.</p>}
            </>
          )}
          {mode === "exam" && (
            <>
              <p className="mut">{d.exam.week ? "This is exam week." : "There is no exam this week."}</p>
              {d.exam.why && <p className="pp-why">{d.exam.why}</p>}
              <div className="row">
                <button type="button" className="go" disabled={busy || !d.atOwn || !!d.busy || !!d.exam.why} onClick={() => sitExam(false)}>Sit honestly</button>
                <button type="button" className="gx-risk" disabled={busy || !d.atOwn || !!d.busy || !!d.exam.why} onClick={() => sitExam(true)}>Try to cheat</button>
              </div>
            </>
          )}
          {note && <p className="pp-ok">{note}</p>}
          {!d.atOwn && <button type="button" onClick={() => { onClose(); router.push("/map"); }}>Open the map</button>}
        </>
      )}
    </Sheet>
  );
}

/** What a hub's `act` opens. Returns the panel for an act, or null if it is not one of ours. */
export function panelFor(act, onClose) {
  if (act === "crew" || act === "backstairs") return <HustlePanel kind={act} onClose={onClose} />;
  if (["faculty", "lecture", "test", "exam"].includes(act)) return <FacultyPanel mode={act} onClose={onClose} />;
  return null;
}