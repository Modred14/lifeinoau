// src/app/play/page.js
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut, say } from "@/lib/client";
import { toast } from "@/lib/toast";
import dynamic from "next/dynamic";
import CreateFlow from "@/components/CreateFlow";
import LifeRoll from "@/components/LifeRoll";
import HostelPicker from "@/components/HostelPicker";
import Loader from "@/components/Loader";
import { Icon } from "@/components/Icon";
import { CLASS_INFO } from "@/lib/classes.js";
import { SESSION_WEEKS } from "@/lib/engine.js";
import "./play.css";
const CharacterViewer = dynamic(() => import("@/components/CharacterViewer"), { ssr: false, loading: () => <div className="stage" style={{ height: "100%" }} aria-busy="true" /> });

const STATS = [["Health", "health", "health"], ["Energy", "energy", "energy"], ["Happiness", "happiness", "happy"], ["Academics", "academics", "study"], ["Popularity", "popularity", "social"], ["Suspicion", "suspicion", "eye"]];

function View({ children }) { return <div className="gh-view">{children}</div>; }

export default function Play() {
  const router = useRouter();
  const [view, setView] = useState("loading"), [st, setSt] = useState(null), [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false), [reveal, setReveal] = useState(null);
  const shown = useRef(new Set()), pending = useRef(0);
  const [now, setNow] = useState(Date.now());

  // Game notifications become persistent info toasts. Once the last one is closed they are marked read.
  const showNotes = useCallback((list) => {
    const fresh = (list ?? []).filter((n) => !shown.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => shown.current.add(n.id));
    const groups = fresh.length > 3 ? [{ id: "batch-" + fresh[0].id, body: fresh.map((n) => n.body).join("\n") }] : fresh;
    pending.current += groups.length;
    const closed = () => { pending.current = Math.max(0, pending.current - 1); if (pending.current === 0) call("/api/notifications", {}); };
    groups.forEach((n) => toast.info(n.body, { id: "note-" + n.id, persistent: true, onDismiss: closed }));
  }, []);

  const load = useCallback(async () => {
    const s = await call("/api/state");
    if (s.status === 401) return loggedOut(router);
    if (s.status === 404) { const m = await call("/api/meta"); setMeta(m); return setView((v) => (v === "reveal" ? v : "create")); } // a late reply must never pull the player off the roll
    if (s.failed) { notifyError(s); return setView("error"); }
    setSt(s); setView((v) => (v === "reveal" ? v : s.character.hostel ? "game" : "hostel")); showNotes(s.notifications);
  }, [router, showNotes]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [view]); // a new screen always starts at its top
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  async function run(path, body, describe) {
    if (busy) return; setBusy(true);
    const res = await call(path, body); setBusy(false);
    if (res.status === 401) return loggedOut(router);
    if (res.failed) notifyError(res, "Something went wrong. Please try again.");
    else if (res.duplicate) toast.info("That was already done.");
    else if (describe) say(describe(res));
    await load();
  }
  const act = (action) => run("/api/action", { action, requestId: crypto.randomUUID() }, () => ({ text: action === "rest" ? "You rested and feel better." : "Safe hustle done. Cash added." }));
  const risky = () => run("/api/risky", { requestId: crypto.randomUUID() }, (r) => r.caught
    ? { bad: true, text: `DSA HAS CAUGHT YOU. They seized ${naira(r.seizedKobo)}.${r.expelled ? " You have been expelled." : r.suspended ? " You are suspended for 2 weeks." : ""}` }
    : BigInt(r.earnedKobo) > 0n ? { text: `The hustle paid ${naira(r.earnedKobo)}. DSA is watching.` } : { info: true, text: "The hustle went nowhere." });
  const exam = (cheat) => run("/api/exam", { cheat, requestId: crypto.randomUUID() }, (r) =>
    ({ bad: r.caught, text: r.caught ? `Caught cheating. Score ${r.score}, grade point ${r.gradePoint}.` : `Score ${r.score}, grade point ${r.gradePoint}.` }));
  const call_ = () => run("/api/parent/call", {}, (r) => ({ text: BigInt(r.gift) > 0n ? `Your parent sent you ${naira(r.gift)}.` : "Your parent was glad to hear from you." }));

  async function create(payload) {
    setBusy(true);
    const res = await call("/api/character", payload); setBusy(false);
    if (res.status === 401) return loggedOut(router);
    if (res.failed) return notifyError(res, "We couldn't create your character. Please try again.");
    setReveal(res); setView("reveal");
  }

  if (view === "loading") return <Loader label="Loading your life" />;
  if (view === "error") return <View key={view}><div className="gh-empty"><span className="gh-emptyico"><Icon name="warn" size={28} /></span><h2>Your game didn&apos;t load</h2><p className="mut">Check your connection and try again.</p><button type="button" className="go" onClick={load}>Try again</button></div></View>;
  if (view === "create") return <View key={view}><CreateFlow meta={meta} busy={busy} onSubmit={create} /></View>;
  if (view === "reveal") return <View key={view}><LifeRoll result={reveal.class} hostels={reveal.hostels} onContinue={() => { setView("hostel"); load(); }} /></View>;
  if (view === "hostel") return <View key={view}><HostelPicker cls={st?.character?.class ?? reveal?.class} hostels={st?.hostels ?? reveal?.hostels ?? []} busy={busy} onChoose={(h) => run("/api/character/hostel", { hostel: h }, () => ({ text: `You moved into ${h}. Welcome home.` }))} /></View>;

  const c = st.character, a = st.academics, fz = st.floorZero, left = fz ? Math.max(0, new Date(fz.releaseAt) - now) : 0, info = CLASS_INFO[c.class];
  const mm = (ms) => `${Math.floor(ms / 3600000)}h ${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}m ${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}s`;
  if (c.graduated) return <View key={view}><div className="gh-end"><span className="gh-endico"><Icon name="forbes" size={34} /></span><h1>You did it</h1><p className="gh-endclass">{c.classification}</p><div className="gh-endstats"><div><span className="mut">Final CGPA</span><b className="num">{(c.finalCgpaX100 / 100).toFixed(2)}</b></div><div><span className="mut">Cash</span><b className="num">{naira(st.balanceKobo)}</b></div></div></div></View>;
  if (c.expelled) return <View key={view}><div className="gh-end gh-bad"><span className="gh-endico"><Icon name="warn" size={34} /></span><h1>Your story ends here</h1><p className="mut">You were expelled or withdrawn. Final CGPA so far: {a.cgpa ?? "none"}.</p></div></View>;
  const stopped = !!fz, examToday = a.nextExamWeek === st.week && !a.satThisWeek, sessionDone = Math.min(100, Math.round(((SESSION_WEEKS - a.weeksLeftInSession) / SESSION_WEEKS) * 100));
  const ACTIONS = [
    { id: "rest", icon: "moon", name: "Rest", note: "Free. Win back energy.", run: () => act("rest"), off: false },
    { id: "hustle", icon: "hustle", name: "Safe hustle", note: "20 energy. Earns ₦8k to ₦25k.", run: () => act("hustle"), off: c.energy < 20, why: "Needs 20 energy" },
    { id: "risky", icon: "dice", name: "Risky hustle", note: "25 energy. Big money, or DSA.", run: risky, off: c.energy < 25, why: "Needs 25 energy", tone: "risk" },
    { id: "call", icon: "call", name: "Call parent", note: st.calledThisWeek ? "Done for this week." : "Once a week.", run: call_, off: st.calledThisWeek, why: "Done this week", free: true },
  ];
  return (<View key={view}>
    <div className="gh">
      {fz && (<section className="gh-jail" aria-labelledby="fz-h"><span className="gh-jailico"><Icon name="siren" size={24} /></span><div className="gh-jailtxt"><h2 id="fz-h">You are on Floor 0</h2><p>Time left <b className="num">{mm(left)}</b>. Your sentence ends on its own, or you can pay the bill.</p></div><button type="button" className="go" disabled={busy} onClick={() => run("/api/floor0/pay", {}, () => ({ text: "Bail paid. You're free." }))}>Pay {naira(fz.billKobo)}</button></section>)}

      <section className="gh-hero" style={{ "--cls": info?.color }}>
        <div className="gh-stage"><CharacterViewer look={c.look ?? undefined} gender={c.gender} hint={false} /></div>
        <div className="gh-id">
          <span className="gh-class">{c.class}</span>
          <h1>{c.name}</h1>
          <p className="mut">{c.faculty}</p>
          <ul className="gh-tags"><li><Icon name="hostel" size={15} /> {c.hostel}</li><li><Icon name="faculty" size={15} /> {c.level} level</li>{c.personalities.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </section>

      <section className="gh-card" aria-labelledby="vit-h"><h2 id="vit-h">How you are doing</h2>
        <div className="gh-vitals">{STATS.map(([n, k, ic]) => { const v = c[k], tone = k === "suspicion" ? (v >= 60 ? "risk" : v >= 30 ? "warn" : "ok") : v < 25 ? "low" : "ok";
          return (<div key={k} className="gh-vital" data-tone={tone}><Icon name={ic} size={20} /><div className="gh-vbody"><div className="gh-vtop"><span>{n}</span><b className="num">{v}</b></div><div className="gh-meter" role="meter" aria-label={n} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}><i style={{ width: v + "%" }} /></div></div></div>); })}</div>
      </section>

      <section className="gh-card" aria-labelledby="ac-h">
        <div className="gh-achead"><div><h2 id="ac-h">Academics</h2><p className="mut">{a.weeksLeftInSession} weeks left in this session</p></div>
          <div className="gh-cgpa"><b className="num">{a.cgpa ?? "–"}</b><span className="mut">{a.standing ? `CGPA, ${a.standing}` : "CGPA"}</span></div></div>
        <div className="gh-session" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sessionDone}><i style={{ width: sessionDone + "%" }} /></div>
        <div className="gh-strikes"><span className="mut">Strikes</span><span className="gh-pips" aria-label={`${c.strikes} of 5 strikes`}>{Array.from({ length: 5 }, (_, i) => <i key={i} data-on={i < c.strikes ? "true" : undefined} />)}</span><span className="mut">3 means suspension, 5 means expulsion</span></div>
        {examToday ? (<div className="gh-exam"><div className="gh-examtxt"><Icon name="warn" size={22} /><div><b>Exam today</b><p>Sit it before the week ends.</p></div></div>
          <div className="gh-examacts"><button type="button" className="go" disabled={busy || stopped} onClick={() => exam(false)}>Sit honestly</button><button type="button" className="gh-risk" disabled={busy || stopped} onClick={() => exam(true)}>Try to cheat</button></div></div>)
          : <p className="gh-next"><Icon name="timer" size={18} /> Next exam is in week {a.nextExamWeek}.</p>}
      </section>

      <section className="gh-card" aria-labelledby="do-h"><h2 id="do-h">What will you do?</h2>
        <div className="gh-actions">{ACTIONS.map((x) => (<button key={x.id} type="button" className="gh-act" data-tone={x.tone} disabled={busy || stopped || x.off} onClick={x.run}>
          <span className="gh-actico"><Icon name={x.icon} size={22} /></span><b>{x.name}</b><span className="mut">{x.off && x.why && !x.free ? x.why : x.note}</span></button>))}</div>
      </section>
    </div>
  </View>);
}