// components/ActivityLayer.js
// What you can DO inside a building: the prompt beside a ring, the panel that starts an activity, the progress while it runs, and the result.
// The rules (cost, time, limits) and the position check are on the server (lib/activityService.js); this only shows them and asks. It reports where
// you stand every few seconds, and stops the activity the moment you walk away from the ring.
"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
/** "−2 energy · +2 happiness · 15s" -> small coloured chips (gain, loss, time, anything else). */
const fx = (sub = "") => String(sub).split(" · ").filter(Boolean).map((t) => ({ t, k: /^\+/.test(t) ? "gain" : /^[−-]/.test(t) ? "loss" : /^\d+\s?s$/.test(t) ? "time" : "info" }));
const needsCourse = (k) => k === "course_attend" || k === "course_study" || k === "course_test";

/** `api` is a ref to the 3D scene, `rings` the activity rings drawn in it, `open` the ring whose panel is showing, `onClose` closes it, `onLeave` leaves the building. */
export default function ActivityLayer({ api, rings, open, onClose, onLeave, ready, onState, onRun, controlRef }) {
  const [st, setSt] = useState(null), [run, setRun] = useState(null), [busy, setBusy] = useState(false), [course, setCourse] = useState(""), [tick, setTick] = useState(() => serverTime()), [done, setDone] = useState(null);
  const runRef = useRef(null), finishing = useRef(false), starting = useRef(false), e0 = useRef(0); // e0: energy when the run began (for the rising bar while sleeping)
  const pos = () => { const s = api.current?.state; return s ? { x: s.x, z: s.z, floor: s.floor } : null; };
  const ring = (id) => rings.find((r) => r.activity === id);
  // the card is docked on the bottom bar like the activities panel: tell the room how tall it is so the stick and buttons stay clear of it
  const card = useRef(null);
  useLayoutEffect(() => {
    const el = card.current, scene = el?.closest(".bi3"); if (!el || !scene) return;
    const m = () => scene.style.setProperty("--bp-h", `${Math.round(el.getBoundingClientRect().height)}px`); m();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(m) : null; ro?.observe(el);
    return () => ro?.disconnect();
  }, [!!open]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    const r = await call("/api/activity"); if (r.failed) { onState?.({ failed: true, error: r.error }); return null; }
    setSt(r); if (r.run && !runRef.current) { runRef.current = r.run; setRun(r.run); } if (!r.run && runRef.current && !finishing.current) { runRef.current = null; setRun(null); api.current?.setPose(null); }
    setCourse((c) => c || r.courses?.[0]?.code || ""); return r;
  }, [api]);
  useEffect(() => { onState?.(st); }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onRun?.(run ? run.hubId : null); }, [run?.hubId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (controlRef) controlRef.current = { refresh }; }, [controlRef, refresh]);
  const stop = useCallback((why) => { runRef.current = null; setRun(null); api.current?.setPose(null); if (why) toast.info(why); }, [api]);

  // where you stand: reported on arrival and every few seconds, only while the tab is showing
  useEffect(() => {
    if (!ready) return; let on = true;
    // One report at a time, always carrying the spot at the moment it is sent: a slow answer is never queued behind by another report, and an old answer is ignored once the room has been left.
    // Where you stand is local and never waits for this; a failed report is simply replaced by the next one.
    let busy = false;
    const send = async () => { if (busy) return; const p = pos(); if (!p || !on || document.hidden) return; busy = true; try { const r = await call("/api/activity", { op: "report", ...p }); if (on && r.cancelled) { stop("You moved away, so it stopped."); refresh(); } } finally { busy = false; } };
    refresh(); send(); const a = setInterval(send, PRESENCE.pingEveryMs), b = setInterval(() => !document.hidden && !runRef.current && refresh(), 20000);
    return () => { on = false; clearInterval(a); clearInterval(b); };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(async () => {
    const cur = runRef.current; if (!cur || finishing.current) return; finishing.current = true;
    try {
      const p = pos(), r = await call("/api/activity", { op: "finish", requestId: crypto.randomUUID(), ...p });
      if (r.failed) { if (r.status === 409 && /not finished yet/i.test(r.error ?? "")) { finishing.current = false; return; } notifyError(r); stop(); refresh(); return; }
      stop();
      if (r.duplicate) { toast.info("That one was already counted."); game.refresh(); }
      else if (r.cancelled) toast.info(r.message ?? "It was cancelled.");
      else if (r.caught) { toast.error(`N-QRS HAS CAUGHT YOU. They seized ${naira(r.seizedKobo)} and you are in Floor O (N-QRS Custody). Bail starts at ${naira(r.billKobo)}.${r.expelled ? " You have been expelled." : r.suspended ? " You have been suspended." : ""}`, { duration: 9000 }); game.refresh(); onLeave?.(); return; }
      else {
        const bits = [...(r.earnedKobo && r.earnedKobo !== "0" ? [`+${naira(r.earnedKobo)}`] : []), ...chips(r.applied), ...(r.score != null ? [r.outOf ? `${r.score}/${r.outOf}` : `score ${r.score}, grade point ${r.gradePoint}`] : [])];
        const text = r.note ?? r.message ?? "Done."; setDone({ text, bits, capped: r.capped?.length > 0, bad: !!r.caught });
        toast[r.caught ? "error" : "success"](`${text}${bits.length ? " " + bits.join(" · ") : ""}`, r.earnedKobo && r.earnedKobo !== "0" ? { sound: "coin" } : undefined);
        game.refresh();
        onClose?.(); // done: the card hands the dock back to the activities panel (the result is in the toast)
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

  const info = open ? st?.hubs?.find((h) => h.id === open.activity) : null;
  const begin = async (param) => {
    if (!info || busy || run || starting.current) return; const p = pos(); if (!p) { toast.error("Your position is not known yet. Walk a step and try again."); return; }
    starting.current = true; // one start at a time, even for a double tap (the state below only updates on the next render)
    try {
      if (info.kind === "hustle_risky" && !open?.confirmed && !(await confirmAction({ title: "Back-Room Deal: VERY RISKY", message: `You either make ₦${HUSTLE.risky.min.toLocaleString("en-NG")} to ₦${HUSTLE.risky.max.toLocaleString("en-NG")}, or N-QRS catches you and you serve ${HUSTLE.risky.jailMin} to ${HUSTLE.risky.jailMax} minutes inside Floor O (N-QRS Custody). You can only try once a day.`, confirmLabel: "Take the risk", tone: "danger" }))) return;
      if (param === "cheat" && !(await confirmAction({ title: "Cheat in the exam?", message: "If you are caught you score very low, get a strike and may be suspended. If not, you gain marks.", confirmLabel: "Cheat anyway", tone: "danger" }))) return;
      setBusy(true); setDone(null);
      const startE = st?.energy ?? null, h0 = rings.find((q) => q.activity === info.id);
      try {
        if (h0 && Math.hypot(p.x - h0.x, p.z - h0.z) > 0.2) { const ok = await api.current?.walkTo(h0.x, h0.z, h0.floor ?? 0); if (!ok) { toast.error("You could not get onto the ring. Walk onto it and press Start again."); return; } } // it walks to the ring first, so it looks real
        const p2 = pos() ?? p;
        const r = await call("/api/activity", { op: "start", hubId: info.id, requestId: crypto.randomUUID(), ...p2, param: param ?? (needsCourse(info.kind) ? course : undefined) });
        if (r.failed) { notifyError(r); refresh(); return; }
        if (r.duplicate) { refresh(); return; }
        e0.current = startE ?? st?.energy ?? 0; const cur = { id: "", activityId: r.activityId, hubId: info.id, endsAt: r.endsAt, startedAt: r.endsAt - (r.sec ?? ACTIVITY_SECONDS) * 1000 }; runRef.current = cur; setRun(cur); setTick(serverTime()); api.current?.setPose(r.anim, r.activityId);
        if (r.paid) { game.refresh(); toast.info(`Paid ${naira(BigInt(r.paid) * 100n)}.`); }
      } finally { setBusy(false); }
    } finally { starting.current = false; }
  };
  // The activities panel walked the character here: start the plain activities at once (the person already pressed "walk there" knowing the price).
  // Anything that needs a choice (a course, the exam) or a confirmation (risky) waits for the person at the ring.
  const autoed = useRef(null);
  useEffect(() => {
    if (!open?.auto || autoed.current === open || !st || !info || run || busy || info.blocked) return;
    autoed.current = open; if (info.kind !== "stats" && info.kind !== "hustle_safe") return;
    begin();
  }, [open, st, info, run, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = async () => { await call("/api/activity", { op: "cancel" }); stop("You stopped. A fee already paid is not refunded."); refresh(); onClose?.(); };

  const sec = run ? Math.max(0, Math.ceil((run.endsAt - tick) / 1000)) : 0, total = run ? Math.max(1, Math.round((run.endsAt - run.startedAt) / 1000)) : 1;
  const prog = run ? Math.min(1, 1 - sec / total) : 0, energyNow = Math.round(e0.current + (100 - e0.current) * prog); // sleeping: energy climbs evenly to 100%
  const runInfo = run ? st?.hubs?.find((h) => h.id === run.hubId) ?? info : null;
  return (
    <>
      {run && !open && <div className="bi3-run" role="status"><Icon name={runInfo?.icon ?? "timer"} size={18} /><span>{runInfo?.doing ?? "Working…"} {runInfo?.full ? `Energy ${energyNow}%` : `${sec}s`}</span><i style={{ width: `${Math.min(100, (1 - sec / total) * 100)}%` }} /></div>}
      {open && (
        <div className="bi3-act" ref={card} role="dialog" aria-label={open.label}>
          <div className="bi3-act-h">
            <span className="bi3-act-ico"><Icon name={info?.icon ?? "sparkle"} size={22} weight="fill" /></span>
            <b className="bi3-act-title">{open.label}</b>{info?.kind === "hustle_risky" && <i className="bp-risky">RISKY</i>}
            <button type="button" className="bi3-x" aria-label="Close" onClick={onClose} data-sound="none"><Icon name="close" size={18} /></button>
          </div>
          <div className="bi3-act-b">
          {!st ? <p className="mut">Checking…</p> : !info ? <p className="mut">That is not available right now.</p> : (
            <>
              <ul className="bi3-fx" aria-label="What it does">{fx(info.sub).map((f, i) => <li key={i} data-k={f.k}>{f.k === "time" && <Icon name="timer" size={13} />}{f.t}</li>)}</ul>
              {info.kind === "hustle_risky" && <p className="bi3-act-why" role="note"><i className="bp-risky">RISKY</i> You may be caught: cash is seized and you serve time in Floor O (N-QRS Custody).</p>}
              {run ? (
                <>
                  <div className="bi3-live">
                    <div className="bi3-live-row"><span>{info.doing}</span><b>{info.full ? `Energy ${energyNow}%` : `${sec}s`}</b></div>
                    <div className="bi3-prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prog * 100)} aria-label="Progress"><i style={{ width: `${Math.min(100, prog * 100)}%` }} /></div>
                    <p className="bi3-act-doing"><Icon name="pin" size={14} weight="fill" /> Stay on the ring</p>
                  </div>
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
          </div>
        </div>
      )}
    </>
  );
}