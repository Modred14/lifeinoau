// components/apps/SugGovernment.js: the Government tab of the SUG app (see components/apps/SugApp.js).
// Who holds each office, the 30 Honourable Members, the Clerk, the term dates and the official announcements. Offices are powers inside
// the Students' Union only; they never give any access to the administration of the app.
"use client";
import { useState } from "react";
import { confirmAction } from "@/lib/confirm";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import { useLive, useDo, Countdown, when, Note, Empty, Section } from "./sugKit";

const POSTS = [["PRESIDENT", "SUG President"], ["VICE_PRESIDENT", "SUG Vice President"], ["SECRETARY_GENERAL", "Secretary General"], ["ASSISTANT_SECRETARY_GENERAL", "Assistant Secretary General"],
  ["PRO", "Public Relations Officer"], ["DIRECTOR_SOCIALS", "Director of Socials"], ["DIRECTOR_SPORTS", "Director of Sports"], ["FINANCIAL_SECRETARY", "Financial Secretary"], ["WELFARE_OFFICER", "Welfare Officer"],
  ["SPEAKER", "Speaker of the Assembly"], ["DEPUTY_SPEAKER", "Deputy Speaker"]];

function Holder({ title, h }) {
  return (
    <li className="sg-holder" data-vacant={h ? undefined : "1"}>
      <span className="sg-ava" aria-hidden="true">{h ? h.who.name.slice(0, 1) : "–"}</span>
      <span><b>{h ? h.who.name : "Vacant"}{h?.isMe ? " (you)" : ""}</b><small>{title}{h?.who.faculty ? ` · ${h.who.faculty}` : ""}</small></span>
    </li>
  );
}

function Announce({ d, doIt }) {
  const kinds = d.me.announceKinds, [kind, setKind] = useState(kinds[0]), [title, setTitle] = useState(""), [body, setBody] = useState("");
  if (!kinds.length || d.term?.state !== "ACTIVE") return null;
  async function go() {
    if (!(await confirmAction({ title: "Send to every student?", message: `This ${d.announceKinds[kind].toLowerCase()} announcement goes to every student as a notification, and is signed with your office. You can only send a few a day.`, confirmLabel: "Send announcement" }))) return;
    const r = await doIt({ action: "announce", kind, title, body }, { ok: "Announcement sent.", key: "gov:announce" });
    if (!r.failed) { setTitle(""); setBody(""); }
  }
  return (
    <div className="sg-card sg-form">
      <h4>Make an announcement</h4>
      <p className="sg-hint">Your office may publish: {kinds.map((k) => d.announceKinds[k]).join(", ")}.</p>
      {kinds.length > 1 ? <label>Kind<select value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{d.announceKinds[k]}</option>)}</select></label> : null}
      <label>Title<input type="text" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Announcement<textarea rows={4} value={body} maxLength={600} onChange={(e) => setBody(e.target.value)} /></label>
      <button type="button" className="go" disabled={title.trim().length < 3 || body.trim().length < 10} onClick={go}>Send</button>
    </div>
  );
}

function ClerkPanel({ d, doIt }) {
  const [name, setName] = useState("");
  if (!d.term) return null;
  async function appoint() {
    if (!(await confirmAction({ title: `Appoint ${name.trim()} as Clerk?`, message: "The Clerk records attendance, registers bills and publishes the minutes. The Clerk cannot vote or change the outcome of any vote. The appointment ends with this term.", confirmLabel: "Appoint" }))) return;
    const r = await doIt({ action: "clerk.appoint", name }, { ok: "The Clerk is appointed.", key: "gov:clerk" });
    if (!r.failed) setName("");
  }
  async function revoke() {
    if (!(await confirmAction({ title: "Remove the Clerk?", message: `${d.clerk.who.name} stops being Clerk straight away. Their record stays in the history.`, confirmLabel: "Remove", tone: "danger" }))) return;
    await doIt({ action: "clerk.revoke" }, { ok: "The Clerk has been removed.", key: "gov:clerk" });
  }
  return (
    <>
      <ul className="sg-people"><Holder title="Clerk of the Assembly (appointed)" h={d.clerk} /></ul>
      {d.me.canAppointClerk ? (
        <div className="sg-invite">
          <input type="text" value={name} placeholder="Name of the student to appoint" onChange={(e) => setName(e.target.value)} aria-label="Clerk's name" />
          <button type="button" className="go" disabled={name.trim().length < 2} onClick={appoint}>{d.clerk ? "Replace" : "Appoint"}</button>
          {d.clerk ? <button type="button" className="danger" onClick={revoke}>Remove</button> : null}
        </div>
      ) : null}
    </>
  );
}

export default function SugGovernment() {
  const { d, load, loadFailed } = useLive("/api/sug/government", 30000), doIt = useDo("/api/sug/government", load);
  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Loader label="Loading the government" />;
  if (!d.term) return <div className="sg-stack"><Note tone="info" title="No government yet">A government is formed when an election has been decided. Until then no one holds office.</Note></div>;
  const t = d.term, label = { FORMING: "Forming", ACTIVE: "In office", ENDED: "Term ended" }[t.state];
  return (
    <div className="sg-stack">
      <div className="sg-banner" data-stage={t.state === "ACTIVE" ? "ACTIVE" : t.state === "FORMING" ? "FORMATION" : "COMPLETED"}>
        <small>Election {t.cycleNumber}</small><h2>{label}</h2>
        <p>Term {when(t.startsAt)} to {when(t.endsAt)}.</p>
        {t.state !== "ENDED" ? <div className="sg-next"><span>{t.state === "FORMING" ? "Takes office in" : "Term ends in"}</span><Countdown at={t.state === "FORMING" ? t.startsAt : t.endsAt} label="Term" /></div> : <p>Their powers have ended. The record below is kept.</p>}
      </div>
      {d.me.offices.length ? <Note tone="good" title="Your office">{d.me.offices.map((o) => o.title).join(", ")}. This gives you powers only inside the Students' Union.</Note> : null}
      {d.vacancies.length ? <Note tone="info" title="Vacant seats">{d.vacancies.map((v) => v.replace(/_/g, " ").toLowerCase()).join(", ")}</Note> : null}
      <Announce d={d} doIt={doIt} />
      <Section title="Executive">
        <ul className="sg-people">{POSTS.filter(([k]) => !["SPEAKER", "DEPUTY_SPEAKER"].includes(k)).map(([k, title]) => <Holder key={k} title={title} h={d.holders[k]} />)}</ul>
      </Section>
      <Section title="Assembly leadership"><ul className="sg-people">{["SPEAKER", "DEPUTY_SPEAKER"].map((k) => <Holder key={k} title={POSTS.find((p) => p[0] === k)[1]} h={d.holders[k]} />)}</ul><ClerkPanel d={d} doIt={doIt} /></Section>
      <Section title={`Honourable Members (${d.members.length} of 30)`}>
        {d.members.length ? <ul className="sg-people sg-two">{d.members.map((m) => <Holder key={m.seat} title={`Seat ${m.seat}`} h={m} />)}</ul> : <Empty>No members seated.</Empty>}
      </Section>
      <Section title="Announcements" hint="Official notices from the government, newest first.">
        {d.announcements.length ? d.announcements.map((a) => <div className="sg-msg" key={a.id}><b>{a.title}</b><small>{a.kindLabel} · {a.positionTitle} · {a.author} · {when(a.at)}</small><p>{a.body}</p></div>) : <Empty>No announcements yet.</Empty>}
      </Section>
    </div>
  );
}