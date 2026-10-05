// app/play/page.js
"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira } from "@/lib/client";

const STATS = [["Health", "health"], ["Energy", "energy"], ["Happiness", "happiness"], ["Academics", "academics"], ["Popularity", "popularity"], ["Suspicion", "suspicion"]];
const ACTIONS = [
  ["class", "Attend class", "12 energy"], ["study", "Study", "15 energy"], ["rest", "Rest", "free"],
  ["hustle", "Safe hustle", "20 energy · earns ₦8k–25k"],
];

export default function Play() {
  const router = useRouter();
  const [view, setView] = useState("loading"), [st, setSt] = useState(null), [meta, setMeta] = useState(null);
  const [msg, setMsg] = useState(null), [busy, setBusy] = useState(false), [reveal, setReveal] = useState(null);
  const [form, setForm] = useState({ name: "", gender: "", facultyId: "", personalities: [] });
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const s = await call("/api/state");
    if (s.status === 401) return router.push("/");
    if (s.status === 404) { setMeta(await call("/api/meta")); return setView("create"); }
    if (s.failed) { setMsg({ bad: true, text: s.error }); return setView("error"); }
    setSt(s); setView(s.character.hostel ? "game" : "hostel");
  }, [router]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  async function run(path, body, describe) {
    if (busy) return; setBusy(true); setMsg(null);
    const res = await call(path, body); setBusy(false);
    if (res.failed) setMsg({ bad: true, text: res.error ?? "Something went wrong." });
    else if (res.duplicate) setMsg({ text: "That was already done." });
    else if (describe) setMsg(describe(res));
    await load();
  }
  const act = (action) => run("/api/action", { action, requestId: crypto.randomUUID() });
  const risky = () => run("/api/risky", { requestId: crypto.randomUUID() }, (r) => r.caught
    ? { bad: true, text: `🚨 DSA HAS CAUGHT YOU. They seized ${naira(r.seizedKobo)}.${r.expelled ? " You have been expelled." : r.suspended ? " You are suspended for 2 weeks." : ""}` }
    : { text: BigInt(r.earnedKobo) > 0n ? `The hustle paid ${naira(r.earnedKobo)}. DSA is watching.` : "The hustle went nowhere." });
  const exam = (cheat) => run("/api/exam", { cheat, requestId: crypto.randomUUID() }, (r) =>
    ({ bad: r.caught, text: r.caught ? `Caught cheating. Score ${r.score}, grade point ${r.gradePoint}.` : `Score ${r.score}, grade point ${r.gradePoint}.` }));
  const call_ = () => run("/api/parent/call", {}, (r) => ({ text: BigInt(r.gift) > 0n ? `Your parent sent you ${naira(r.gift)}.` : "Your parent was glad to hear from you." }));

  async function create(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const res = await call("/api/character", { ...form, facultyId: Number(form.facultyId) }); setBusy(false);
    if (res.failed) return setMsg({ bad: true, text: res.error });
    setReveal(res); setView("reveal");
  }
  const toggle = (p) => setForm((f) => ({ ...f, personalities: f.personalities.includes(p) ? f.personalities.filter((x) => x !== p) : [...f.personalities, p] }));

  if (view === "loading") return <p className="mut">Loading your life...</p>;
  if (view === "error") return <div className="card"><div className="msg bad" role="alert">{msg?.text}</div><button onClick={load}>Try again</button></div>;

  if (view === "create") return (
    <form onSubmit={create}><h1>Create your student</h1>
      <div className="card"><label>Name<input type="text" required minLength={3} maxLength={20} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label></div>
      <div className="card"><b>Gender</b><div className="row">{[["M", "Male"], ["F", "Female"]].map(([v, l]) => <button type="button" key={v} className={form.gender === v ? "on" : ""} onClick={() => setForm({ ...form, gender: v })}>{l}</button>)}</div></div>
      <div className="card"><b>Faculty</b><div className="row">{meta?.faculties?.map((f) => <button type="button" key={f.id} className={form.facultyId == f.id ? "on" : ""} onClick={() => setForm({ ...form, facultyId: f.id })}>{f.name}</button>)}</div></div>
      <div className="card"><b>Personality</b> <span className="mut">(pick at least one)</span><div className="row">{meta?.personalities?.map((p) => <button type="button" key={p} className={form.personalities.includes(p) ? "on" : ""} onClick={() => toggle(p)}>{p}</button>)}</div></div>
      {msg && <div className="msg bad" role="alert">{msg.text}</div>}
      <button className="go" style={{ width: "100%" }} disabled={busy || !form.name || !form.gender || !form.facultyId || !form.personalities.length}>Reveal my life</button>
    </form>);

  if (view === "reveal") { const col = { MAPO: "#3a7bd5", LAPO: "#e0801f", NEPO: "#9b5de5" }[reveal.class];
    return <div className="reveal"><p className="mut">YOUR LIFE HAS BEEN DECIDED...</p><b style={{ color: col }}>{reveal.class}</b><button className="go" onClick={() => { setView("hostel"); load(); }}>Choose where to live</button></div>; }

  if (view === "hostel") return (<><h2>Where will you stay?</h2><p className="mut">Only hostels open to a {st?.character?.class} student are shown.</p>
    <div className="row">{(st?.hostels ?? reveal?.hostels ?? []).map((h) => <button key={h} disabled={busy} onClick={() => run("/api/character/hostel", { hostel: h })}>{h}</button>)}</div>
    {msg && <div className="msg bad" role="alert">{msg.text}</div>}</>);

  const c = st.character, a = st.academics, fz = st.floorZero, left = fz ? Math.max(0, new Date(fz.releaseAt) - now) : 0;
  const mm = (ms) => `${Math.floor(ms / 3600000)}h ${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}m ${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}s`;
  if (c.graduated) return <div className="reveal"><p className="mut">YOU DID IT</p><b>🎓</b><h2>{c.classification}</h2><p>Final CGPA {(c.finalCgpaX100 / 100).toFixed(2)} · Cash {naira(st.balanceKobo)}</p></div>;
  if (c.expelled) return <div className="card"><h2>Your story ends here</h2><p>You were expelled or withdrawn. Final CGPA so far: {a.cgpa ?? "none"}.</p></div>;
  const stopped = !!fz;
  return (<>
    <div className="top"><h2>{c.level}L · Week {st.week}</h2><span className="cash">{naira(st.balanceKobo)}</span></div>
    <div className="row"><a href="/people"><button style={{ width: "100%" }}>👥 People and money</button></a><a href="/leaderboards"><button style={{ width: "100%" }}>🏆 FORBES and boards</button></a><a href="/parties"><button style={{ width: "100%" }}>🎉 Parties</button></a><a href="/relationship"><button style={{ width: "100%" }}>❤️ Relationships</button></a><a href="/achievements"><button style={{ width: "100%" }}>🏆 Achievements</button></a><a href="/career"><button style={{ width: "100%" }}>💼 Jobs and business</button></a><a href="/invest"><button style={{ width: "100%" }}>📈 Invest</button></a></div>
    {st.notifications?.length > 0 && <div className="card" role="status">{st.notifications.map((n) => <p key={n.id}>🔔 {n.body}</p>)}<button onClick={() => run("/api/notifications", {})}>Dismiss</button></div>}
    <div className="mut">{c.name} · {c.faculty} · {c.class} · {c.hostel} · {c.personalities.join(", ")}</div>
    <div className="card stats">{STATS.map(([n, k]) => <div key={k}><div className="top"><span>{n}</span><span className="mut">{c[k]}</span></div><div className="bar"><i style={{ width: c[k] + "%", ...(k === "suspicion" ? { background: "var(--bad)" } : {}) }} /></div></div>)}</div>
    {msg && <div className={"msg " + (msg.bad ? "bad" : "ok")} role="status">{msg.text}</div>}
    {fz && <div className="card"><h2>🚨 Floor 0</h2><p>Time left: <b>{mm(left)}</b></p><button className="go" disabled={busy} onClick={() => run("/api/floor0/pay", {})}>Pay the bill ({naira(fz.billKobo)})</button><p className="mut">Or wait. Your sentence ends on its own.</p></div>}
    <div className="card"><b>🎓 Academics</b><p>CGPA: <b>{a.cgpa ?? "–"}</b> {a.standing && <span className="mut">({a.standing})</span>} · {a.weeksLeftInSession} weeks left in this session · Strikes: {c.strikes}</p>
      {a.nextExamWeek === st.week && !a.satThisWeek ? <><p className="bad"><b>Exam today.</b> Sit it before the week ends.</p><div className="row"><button className="go" disabled={busy || stopped} onClick={() => exam(false)}>Sit honestly</button><button disabled={busy || stopped} onClick={() => exam(true)}>Try to cheat (risky)</button></div></> : <p className="mut">Next exam: week {a.nextExamWeek}.</p>}</div>
    <div className="card"><b>Actions</b><div className="row" style={{ marginTop: 8 }}>
      {ACTIONS.map(([id, l, d]) => <button key={id} disabled={busy || stopped} onClick={() => act(id)}>{l}<br /><span className="mut">{d}</span></button>)}
      <button disabled={busy || stopped} onClick={risky}>Risky hustle<br /><span className="mut">25 energy · big money or DSA</span></button>
      <button disabled={busy || stopped || st.calledThisWeek} onClick={call_}>📞 Call parent<br /><span className="mut">{st.calledThisWeek ? "done this week" : "once a week"}</span></button></div></div>
    <button onClick={load}>Refresh</button></>);
}
