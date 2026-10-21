// components/ActivityLayer.js
// What you can DO inside a building: the prompt beside a ring, the panel that starts an activity, the progress while it runs, and the result.
// The rules (cost, time, limits) and the position check are on the server (lib/activityService.js); this only shows them and asks. It reports where
// you stand every few seconds, and stops the activity the moment you walk away from the ring.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { call, naira, notifyError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { confirmAction } from "@/lib/confirm";
import { game } from "@/lib/gameStore";
import { serverTime } from "@/lib/serverClock";
import { ACTIVITY_SECONDS } from "@/lib/activityTime";
import { HUSTLE } from "@/lib/engine";
import { PRESENCE, waitShort } from "@/lib/activities";
import { Icon } from "./Icon";

const NAMES = { energy: "energy", health: "health", happiness: "happiness", academics: "academics", popularity: "popularity" };
const chips = (a = {}) => Object.entries(a).filter(([k, v]) => NAMES[k] && v).map(([k, v]) => `${v > 0 ? "+" : "−"}${Math.abs(v)} ${NAMES[k]}`);
const needsCourse = (k) => k === "course_attend" || k === "course_study" || k === "course_test";

/** `api` is a ref to the 3D scene, `rings` the activity rings drawn in it, `open` the ring whose panel is showing, `onClose` closes it, `onLeave` leaves the building. */
export default function ActivityLayer({ api, rings, open, onClose, onLeave, ready }) {
  const [st, setSt] = useState(null), [run, setRun] = useState(null), [busy, setBusy] = useState(false), [course, setCourse] = useState(""), [tick, setTick] = useState(() => serverTime()), [done, setDone] = useState(null), [fold, setFold] = useState(false); // the panel opens expanded; the person can fold it with the arrow. (was: opens folded; the person unfolds it
  const runRef = useRef(null), finishing = useRef(false), e0 = useRef(0); // e0: energy when the run began (for the rising bar while sleeping)
  const pos = () => { const s = api.current?.state; return s ? { x: s.x, z: s.z, floor: s.floor } : null; };
  const ring = (id) => rings.find((r) => r.activity === id);

  const refresh = useCallback(async () => {
    const r = await call("/api/activity"); if (r.failed) return null;
    setSt(r); if (r.run && !runRef.current) { runRef.current = r.run; setRun(r.run); } if (!r.run && runRef.current && !finishing.current) { runRef.current = null; setRun(null); api.current?.setPose(null); }
    setCourse((c) => c || r.courses?.[0]?.code || ""); return r;
  }, [api]);
  const stop = useCallback((why) => { runRef.current = null; setRun(null); api.current?.setPose(null); if (why) toast.info(why); }, [api]);

  // where you stand: reported on arrival and every few seconds, only while the tab is showing
  useEffect(() => {
    if (!ready) return; let on = true;
    const send = async () => { const p = pos(); if (!p || !on || document.hidden) return; const r = await call("/api/activity", { op: "report", ...p }); if (r.cancelled) { stop("You moved away, so it stopped."); refresh(); } };
    refresh(); send(); const a = setInterval(send, PRESENCE.pingEveryMs), b = setInterval(() => !document.hidden && !runRef.current && refresh(), 20000);
    return () => { on = false; clearInterval(a); clearInterval(b); };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(async () => {
    const cur = runRef.current; if (!cur || finishing.current) return; finishing.current = true;
    try {
      const p = pos(), r = await call("/api/activity", { op: "finish", requestId: crypto.randomUUID(), ...p });
      if (r.failed) { if (r.status === 409 && /not finished yet/i.test(r.error ?? "")) { finishing.current = false; return; } notifyError(r); stop(); refresh(); return; }
      stop();
      if (r.cancelled) toast.info(r.message ?? "It was cancelled.");
      else if (r.caught) { toast.error(`N-QRS HAS CAUGHT YOU. They seized ${naira(r.seizedKobo)} and you are in Floor O (N-QRS Custody). Bail starts at ${naira(r.billKobo)}.${r.expelled ? " You have been expelled." : r.suspended ? " You have been suspended." : ""}`, { duration: 9000 }); game.refresh(); onLeave?.(); return; }
      else {
        const bits = [...(r.earnedKobo && r.earnedKobo !== "0" ? [`+${naira(r.earnedKobo)}`] : []), ...chips(r.applied), ...(r.score != null ? [r.outOf ? `${r.score}/${r.outOf}` : `score ${r.score}, grade point ${r.gradePoint}`] : [])];
        const text = r.note ?? r.message ?? "Done."; setDone({ text, bits, capped: r.capped?.length > 0, bad: !!r.caught });
        toast[r.caught ? "error" : "success"](`${text}${bits.length ? " " + bits.join(" · ") : ""}`, r.earnedKobo && r.earnedKobo !== "0" ? { sound: "coin" } : undefined);
        game.refresh();
      }
      refresh();
    } finally { finishing.current = false; }
  }, [refresh, stop, onLeave]); // eslint-disable-line react-hooks/exhaustive-deps

  // while an activity runs: count down, finish at the end, stop at once if you walk away from the ring
  useEffect(() => {
    if (!run) return; const h = ring(run.hubId);
    const t = setInterval(() => {
      setTick(serverTime()); const p = pos(); if (p && h && Math.hypot(p.x - h.x, p.z - h.z) > 1.4) { call("/api/activity", { op: "cancel" }); stop("You walked away, so it stopped."); refresh(); return; }
      if (serverTime() >= run.endsAt + 150) finish();
    }, 250);
    return () => clearInterval(t);
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (runRef.current) fetch("/api/activity", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "cancel" }) }).catch(() => {}); }, []); // leaving the building ends a running activity

  useEffect(() => { setFold(false); }, [open?.activity]); // each ring's panel starts expanded
  const info = open ? st?.hubs?.find((h) => h.id === open.activity) : null;
  const begin = async (param) => {
    if (!info || busy || run) return; const p = pos(); if (!p) return;
    if (info.kind === "hustle_risky" && !(await confirmAction({ title: "Back-Room Deal: VERY RISKY", message: `You either make ₦${HUSTLE.risky.min.toLocaleString("en-NG")} to ₦${HUSTLE.risky.max.toLocaleString("en-NG")}, or N-QRS catches you and you serve ${HUSTLE.risky.jailMin} to ${HUSTLE.risky.jailMax} minutes inside Floor O (N-QRS Custody). You can only try once a day.`, confirmLabel: "Take the risk", tone: "danger" }))) return;
    if (param === "cheat" && !(await confirmAction({ title: "Cheat in the exam?", message: "If you are caught you score very low, get a strike and may be suspended. If not, you gain marks.", confirmLabel: "Cheat anyway", tone: "danger" }))) return;
    setBusy(true); setDone(null);
    const startE = st?.energy ?? null, h0 = rings.find((q) => q.activity === info.id);
    if (h0 && Math.hypot(p.x - h0.x, p.z - h0.z) > 0.2) { const ok = await api.current?.walkTo(h0.x, h0.z); if (!ok) { setBusy(false); return; } } // it walks to the ring first, so it looks real
    const p2 = pos() ?? p;
    const r = await call("/api/activity", { op: "start", hubId: info.id, requestId: crypto.randomUUID(), ...p2, param: param ?? (needsCourse(info.kind) ? course : undefined) });
    setBusy(false); if (r.failed) { notifyError(r); refresh(); return; }
    if (r.duplicate) { refresh(); return; }
    e0.current = startE ?? st?.energy ?? 0; const cur = { id: "", activityId: r.activityId, hubId: info.id, endsAt: r.endsAt, startedAt: r.endsAt - (r.sec ?? ACTIVITY_SECONDS) * 1000 }; runRef.current = cur; setRun(cur); setTick(serverTime()); api.current?.setPose(r.anim, r.activityId);
    if (r.paid) game.refresh();
  };
  const cancel = async () => { await call("/api/activity", { op: "cancel" }); stop("You stopped. A fee already paid is not refunded."); refresh(); };

  const sec = run ? Math.max(0, Math.ceil((run.endsAt - tick) / 1000)) : 0, total = run ? Math.max(1, Math.round((run.endsAt - run.startedAt) / 1000)) : 1;
  const prog = run ? Math.min(1, 1 - sec / total) : 0, energyNow = Math.round(e0.current + (100 - e0.current) * prog); // sleeping: energy climbs evenly to 100%
  const runInfo = run ? st?.hubs?.find((h) => h.id === run.hubId) ?? info : null;
  return (
    <>
      {run && !open && <div className="bi3-run" role="status"><Icon name={runInfo?.icon ?? "timer"} size={18} /><span>{runInfo?.doing ?? "Working…"} {runInfo?.full ? `Energy ${energyNow}%` : `${sec}s`}</span><i style={{ width: `${Math.min(100, (1 - sec / total) * 100)}%` }} /></div>}
      {open && (
        <div className="bi3-act" role="dialog" aria-label={open.label}>
          <div className="bi3-act-h">
            <button type="button" className="bi3-act-tg" aria-expanded={!fold} onClick={() => setFold((f) => !f)} data-sound="none">
              <Icon name={info?.icon ?? "sparkle"} size={22} weight="fill" /><b>{open.label}</b><span className="bi3-chev" aria-hidden="true"><Icon name="down" size={16} /></span>
            </button>
            <button type="button" className="bi3-x" aria-label="Close" onClick={onClose} data-sound="none"><Icon name="close" size={18} /></button>
            {run && <i className="bi3-act-bar" style={{ width: `${Math.min(100, (1 - sec / total) * 100)}%` }} />}
          </div>
          {!fold && <div className="bi3-act-b">
          {!st ? <p className="mut">Checking…</p> : !info ? <p className="mut">That is not available right now.</p> : (
            <>
              <p className="bi3-act-sub">{info.sub}</p>
              {run ? (
                <>
                  <div className="bi3-prog" aria-label="Progress"><i style={{ width: `${Math.min(100, (1 - sec / total) * 100)}%` }} /></div>
                  <p className="bi3-act-doing">{info.doing} {info.full ? <b>Energy {energyNow}%</b> : <b>{sec}s</b>} · stay on the ring</p>
                  <div className="bi3-act-btns"><button type="button" className="bi3-b" onClick={cancel} data-sound="none">Stop</button></div>
                </>
              ) : (
                <>
                  {info.blocked && <p className="bi3-act-why" role="alert">{info.blocked}{info.until > Date.now() ? ` Ready in ${waitShort(info.until - Date.now())}.` : ""}</p>}
                  {needsCourse(info.kind) && (st.courses?.length ? <label className="bi3-act-sel"><span>Course</span><select value={course} onChange={(e) => setCourse(e.target.value)}>{st.courses.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.title}</option>)}</select></label> : <p className="mut">You have no courses at the moment.</p>)}
                  {done && !info.blocked && <p className="bi3-act-done">{done.text} {done.bits.join(" · ")}{done.capped ? " (you have gained all you can of some of that for now)" : ""}</p>}
                  <div className="bi3-act-btns">
                    {info.kind === "exam" ? (<><button type="button" className="bi3-b go" disabled={!!info.blocked || busy} onClick={() => begin("")}>Sit honestly</button><button type="button" className="bi3-b risk alt" disabled={!!info.blocked || busy} onClick={() => begin("cheat")}>Try to cheat</button></>)
                      : <button type="button" className={`bi3-b go${info.kind === "hustle_risky" ? " risk" : ""}`} disabled={!!info.blocked || busy || (needsCourse(info.kind) && !course)} onClick={() => begin()}>{busy ? "Starting…" : "Start"}</button>}
                  </div>
                </>
              )}
            </>
          )}
          </div>}
        </div>
      )}
    </>
  );
}