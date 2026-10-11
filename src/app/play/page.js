// src/app/play/page.js
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut, say } from "@/lib/client";
import { toast } from "@/lib/toast";
import dynamic from "next/dynamic";
import CreateFlow from "@/components/CreateFlow";
import Loader from "@/components/Loader";
const CharacterViewer = dynamic(() => import("@/components/CharacterViewer"), { ssr: false, loading: () => <div className="stage" style={{ height: 220 }} aria-busy="true" /> });

const STATS = [["Health", "health"], ["Energy", "energy"], ["Happiness", "happiness"], ["Academics", "academics"], ["Popularity", "popularity"], ["Suspicion", "suspicion"]];
const ACTIONS = [
  ["rest", "Rest", "free"],
  ["hustle", "Safe hustle", "20 energy · earns ₦8k–25k"],
];

export default function Play() {
  const router = useRouter();
  const [view, setView] = useState("loading"), [st, setSt] = useState(null), [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false), [reveal, setReveal] = useState(null);
  const shown = useRef(new Set()), pending = useRef(0);
  const [form, setForm] = useState({ name: "", gender: "", facultyId: "", personalities: [] });
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
    if (s.status === 404) { setMeta(await call("/api/meta")); return setView("create"); }
    if (s.failed) { notifyError(s); return setView("error"); }
    setSt(s); setView(s.character.hostel ? "game" : "hostel"); showNotes(s.notifications);
  }, [router, showNotes]);
  useEffect(() => { load(); }, [load]);
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
    toast.success("Character created. Let's see the life you got.");
    setReveal(res); setView("reveal");
  }

  if (view === "loading") return <Loader label="Loading your life" />;
  if (view === "error") return <div className="card"><p className="mut">Your game didn&apos;t load.</p><button onClick={load}>Try again</button></div>;

  if (view === "create") return <CreateFlow meta={meta} busy={busy} onSubmit={create} />;

  if (view === "reveal") { const K = { MAPO: ["#8fc3ff", "Comfortable. Your family covers the basics: N100,000 a week."], LAPO: ["#ff9a4d", "Self-made hits different. N30,000 a week, so every naira counts."], NEPO: ["#f2b84b", "Born into money. N500,000 a week. Do not waste it."] }[reveal.class];
    return <div className="reveal"><p className="mut" style={{ letterSpacing: "0.12em" }}>YOUR LIFE HAS BEEN DECIDED</p><b style={{ color: K[0] }}>{reveal.class}</b><p style={{ margin: "12px auto" }}>{K[1].replace(/N(\d)/g, "₦$1")}</p><button className="go" onClick={() => { setView("hostel"); load(); }}>Choose where to live</button></div>; }

  if (view === "hostel") { const RENT = { "Off-campus": 6000, Ojaja: 15000 };
    return (<><h1 style={{ fontSize: "1.8rem" }}>Where will you stay?</h1><p className="mut">Only places open to a {st?.character?.class ?? reveal?.class} student are shown. Rent is paid every game week.</p>
    <div className="row" style={{ marginTop: 12 }}>{(st?.hostels ?? reveal?.hostels ?? []).map((h) => <button key={h} type="button" className="trait" style={{ minHeight: 88 }} disabled={busy} onClick={() => run("/api/character/hostel", { hostel: h }, () => ({ text: `You moved into ${h}. Welcome home.` }))}><b>{h}</b><span className="mut num">Rent ₦{(RENT[h] ?? 2000).toLocaleString("en-NG")} a week</span></button>)}</div>
  </>); }

  const c = st.character, a = st.academics, fz = st.floorZero, left = fz ? Math.max(0, new Date(fz.releaseAt) - now) : 0;
  const mm = (ms) => `${Math.floor(ms / 3600000)}h ${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}m ${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}s`;
  if (c.graduated) return <div className="reveal"><p className="mut">YOU DID IT</p><b></b><h2>{c.classification}</h2><p>Final CGPA {(c.finalCgpaX100 / 100).toFixed(2)} · Cash {naira(st.balanceKobo)}</p></div>;
  if (c.expelled) return <div className="card"><h2>Your story ends here</h2><p>You were expelled or withdrawn. Final CGPA so far: {a.cgpa ?? "none"}.</p></div>;
  const stopped = !!fz;
  return (<>
    <section className="card" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(130px, 190px) 1fr", alignItems: "center" }}>
      <CharacterViewer look={c.look ?? undefined} gender={c.gender} hint={false} style={{ height: 230 }} />
      <div><h1 style={{ fontSize: "1.6rem" }}>{c.name}</h1><p className="mut">{c.faculty}</p><p className="mut">{c.class} · {c.hostel}</p><p className="mut">{c.personalities.join(" · ")}</p></div>
    </section>
    <div className="card stats">{STATS.map(([n, k]) => <div key={k}><div className="top"><span>{n}</span><span className="mut">{c[k]}</span></div><div className="bar"><i style={{ width: c[k] + "%", ...(k === "suspicion" ? { background: "var(--bad)" } : {}) }} /></div></div>)}</div>
    {fz && <div className="card"><h2>Floor 0</h2><p>Time left: <b>{mm(left)}</b></p><button className="go" disabled={busy} onClick={() => run("/api/floor0/pay", {}, () => ({ text: "Bail paid. You're free." }))}>Pay the bill ({naira(fz.billKobo)})</button><p className="mut">Or wait. Your sentence ends on its own.</p></div>}
    <div className="card"><b>Academics</b><p>CGPA: <b>{a.cgpa ?? "–"}</b> {a.standing && <span className="mut">({a.standing})</span>} · {a.weeksLeftInSession} weeks left in this session · Strikes: {c.strikes}</p>
      {a.nextExamWeek === st.week && !a.satThisWeek ? <><p className="bad"><b>Exam today.</b> Sit it before the week ends.</p><div className="row"><button className="go" disabled={busy || stopped} onClick={() => exam(false)}>Sit honestly</button><button disabled={busy || stopped} onClick={() => exam(true)}>Try to cheat (risky)</button></div></> : <p className="mut">Next exam: week {a.nextExamWeek}.</p>}</div>
    <div className="card"><b>Actions</b><div className="row" style={{ marginTop: 8 }}>
      {ACTIONS.map(([id, l, d]) => <button key={id} disabled={busy || stopped} onClick={() => act(id)}>{l}<br /><span className="mut">{d}</span></button>)}
      <button disabled={busy || stopped} onClick={risky}>Risky hustle<br /><span className="mut">25 energy · big money or DSA</span></button>
      <button disabled={busy || stopped || st.calledThisWeek} onClick={call_}>Call parent<br /><span className="mut">{st.calledThisWeek ? "done this week" : "once a week"}</span></button></div></div>
    <button onClick={load}>Refresh</button></>);
}