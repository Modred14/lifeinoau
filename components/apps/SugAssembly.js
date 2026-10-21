// components/apps/SugAssembly.js: the Assembly tab of the SUG app (see components/apps/SugApp.js).
// Sittings, the order paper (bills and motions), the floor and its debate, attendance and votes. The Speaker (or the Deputy Speaker when
// they hold the chair) runs a sitting, Honourable Members attend, speak, submit and vote, and the Clerk records. The server decides every
// outcome from the votes it has stored; nothing on this screen can change a result.
"use client";
import { useState } from "react";
import { confirmAction } from "@/lib/confirm";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import { useLive, useDo, when, Note, Empty, Section } from "./sugKit";

const STATUS = { SUBMITTED: "Submitted", REGISTERED: "On the order paper", LISTED: "Listed for this sitting", DEBATING: "Being debated", VOTING: "Voting open", PASSED: "Passed", FAILED: "Defeated", WITHDRAWN: "Withdrawn" };
const tone = (s) => (s === "PASSED" ? "WON" : s === "FAILED" || s === "WITHDRAWN" ? "LOST" : s === "VOTING" || s === "DEBATING" ? "RUNOFF" : "TODO");

function Item({ i, d, doIt, open, children }) {
  return (
    <div className="sg-item" data-status={i.status}>
      <div className="sg-item-h"><b>{i.serial ? `${i.serial} · ` : ""}{i.title}</b><span className="sg-pill" data-s={tone(i.status)}>{STATUS[i.status] ?? i.status}</span></div>
      <small>{i.kind === "BILL" ? "Bill" : "Motion"} by {i.author} · {when(i.at)}</small>
      <p className="sg-pre">{i.body}</p>
      {["PASSED", "FAILED"].includes(i.status) ? <p className="sg-tally"><b>{i.yes}</b> yes · <b>{i.no}</b> no · <b>{i.abstain}</b> abstained · {i.present} present · quorum {i.quorum}. {i.outcomeNote}</p> : null}
      {i.myVote ? <small>You voted {i.myVote.toLowerCase()}.</small> : null}
      {children}
    </div>
  );
}

function Floor({ d, doIt }) {
  const s = d.open, item = s?.floorItemId ? d.items.find((i) => i.id === s.floorItemId) : null, [text, setText] = useState("");
  if (!s) return null;
  const member = d.roles.member, voting = item?.status === "VOTING";
  async function speak() { const r = await doIt({ action: "speak", itemId: item.id, body: text }, { ok: "Your contribution is on the record.", key: "asm:speak" }); if (!r.failed) setText(""); }
  async function vote(choice) {
    if (!(await confirmAction({ title: `Vote ${choice.toLowerCase()}?`, message: `You vote ${choice.toLowerCase()} on “${item.title}”. A vote cannot be changed afterwards.`, confirmLabel: `Vote ${choice.toLowerCase()}` }))) return;
    await doIt({ action: "vote", itemId: item.id, choice }, { sensitive: true, pending: "Recording your vote…", ok: "Your vote is recorded.", key: `asm:vote:${item.id}` });
  }
  return (
    <div className="sg-card sg-floor">
      <small>Sitting in progress · chair: {s.chair ?? "–"}</small>
      <h4>{s.title}</h4>
      <p className="sg-hint">{s.present} present · quorum {d.quorum} of {d.seated} seated{s.floorSpeaker ? ` · on the floor: ${s.floorSpeaker}` : ""}</p>
      {item ? (
        <>
          <Item i={item} d={d} doIt={doIt} open />
          <div className="sg-debate">{d.debate.length ? d.debate.map((x) => <p key={x.id}><b>{x.speaker}</b> {x.body}</p>) : <Empty>No one has spoken yet.</Empty>}</div>
          {member && item.status === "DEBATING" && s.floorSpeaker ? <><textarea rows={3} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} placeholder="Your contribution (only when the chair has given you the floor)" /><button type="button" disabled={text.trim().length < 3} onClick={speak}>Speak</button></> : null}
          {member && voting ? (
            <div className="sg-vote" role="group" aria-label="Vote">
              {item.myVote ? <Note tone="good" title={`You voted ${item.myVote.toLowerCase()}`}>Your vote cannot be changed.</Note> : ["YES", "NO", "ABSTAIN"].map((c) => <button key={c} type="button" className={c === "YES" ? "go" : c === "NO" ? "danger" : ""} onClick={() => vote(c)}>{c === "YES" ? "Yes" : c === "NO" ? "No" : "Abstain"}</button>)}
            </div>
          ) : null}
        </>
      ) : <Empty>No item is before the Assembly yet.</Empty>}
    </div>
  );
}

function Chair({ d, doIt }) {
  const s = d.open, [name, setName] = useState(""), floor = s?.floorItemId ? d.items.find((i) => i.id === s.floorItemId) : null;
  const queue = d.items.filter((i) => i.status === "REGISTERED");
  if (!s || !d.iAmChair) return null;
  const act = (action, ok, extra = {}) => doIt({ action, sessionId: s.id, ...extra }, { ok, key: `asm:${action}` });
  async function close() {
    if (!(await confirmAction({ title: "Close the sitting?", message: "Members who did not attend are recorded absent. This cannot be undone.", confirmLabel: "Close sitting", tone: "danger" }))) return;
    await act("session.close", "The sitting is closed.");
  }
  async function closeVote() {
    if (!(await confirmAction({ title: "Close the vote?", message: "The server counts the votes recorded and announces the result. You cannot change it.", confirmLabel: "Close the vote" }))) return;
    await act("vote.close", "The vote is closed.", { itemId: floor.id });
  }
  return (
    <div className="sg-card sg-form">
      <h4>Chair controls</h4>
      {!floor || ["PASSED", "FAILED"].includes(floor.status) ? (
        queue.length ? <div className="sg-list">{queue.map((i) => <div key={i.id} className="sg-row"><span>{i.serial} · {i.title}</span><button type="button" onClick={() => act("item.list", `${i.serial} is before the Assembly.`, { itemId: i.id })}>Put before the Assembly</button></div>)}</div> : <Empty>No registered items waiting.</Empty>
      ) : null}
      {floor?.status === "LISTED" ? <button type="button" className="go" onClick={() => act("debate.open", "Debate is open.", { itemId: floor.id })}>Open the debate</button> : null}
      {floor?.status === "DEBATING" ? (
        <>
          <div className="sg-invite"><input type="text" value={name} placeholder="Give the floor to (member name)" onChange={(e) => setName(e.target.value)} aria-label="Member to recognise" /><button type="button" disabled={!name.trim()} onClick={async () => { const r = await act("recognise", "The floor is theirs.", { name }); if (!r.failed) setName(""); }}>Recognise</button></div>
          <button type="button" className="go" onClick={() => act("vote.open", "Voting is open.", { itemId: floor.id })}>Put it to the vote</button>
        </>
      ) : null}
      {floor?.status === "VOTING" ? <button type="button" className="go" onClick={closeVote}>Close the vote</button> : null}
      <div className="sg-actions">
        {d.roles.speaker ? <button type="button" onClick={() => act("session.handover", "The Deputy Speaker has the chair.")}>Hand the chair to the Deputy</button> : null}
        <button type="button" className="danger" onClick={close}>Close sitting</button>
      </div>
    </div>
  );
}

function Schedule({ doIt }) {
  const [title, setTitle] = useState(""), [agenda, setAgenda] = useState(""), [at, setAt] = useState("");
  async function go() { const r = await doIt({ action: "session.schedule", title, agenda, scheduledAt: Date.parse(at) }, { ok: "Sitting scheduled.", key: "asm:schedule" }); if (!r.failed) { setTitle(""); setAgenda(""); setAt(""); } }
  return (
    <div className="sg-card sg-form">
      <h4>Schedule a sitting</h4>
      <label>Title<input type="text" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Agenda<textarea rows={2} value={agenda} maxLength={600} onChange={(e) => setAgenda(e.target.value)} /></label>
      <label>Date and time<input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
      <button type="button" className="go" disabled={title.trim().length < 3 || !at} onClick={go}>Schedule</button>
    </div>
  );
}

function Submit({ doIt }) {
  const [kind, setKind] = useState("BILL"), [title, setTitle] = useState(""), [body, setBody] = useState("");
  async function go() { const r = await doIt({ action: "item.submit", kind, title, body }, { ok: `Your ${kind === "BILL" ? "bill" : "motion"} is submitted to the Clerk.`, key: "asm:submit" }); if (!r.failed) { setTitle(""); setBody(""); } }
  return (
    <div className="sg-card sg-form">
      <h4>Submit a bill or motion</h4>
      <div className="sg-chips" role="tablist" aria-label="Kind">{[["BILL", "Bill"], ["MOTION", "Motion"]].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>)}</div>
      <label>Title<input type="text" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>What it would do<textarea rows={4} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} /></label>
      <button type="button" className="go" disabled={title.trim().length < 5 || body.trim().length < 20} onClick={go}>Submit</button>
    </div>
  );
}

function Minutes({ s, doIt }) {
  const [text, setText] = useState("");
  return (
    <div className="sg-form"><label>Minutes<textarea rows={4} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="Who was present and what was decided" /></label>
      <button type="button" disabled={text.trim().length < 20} onClick={async () => { if (!(await confirmAction({ title: "Publish the minutes?", message: "Minutes are published once and cannot be edited.", confirmLabel: "Publish" }))) return; await doIt({ action: "minutes", sessionId: s.id, minutes: text }, { ok: "Minutes published.", key: "asm:minutes" }); }}>Publish minutes</button></div>
  );
}

function Mark({ s, doIt }) {
  const [name, setName] = useState("");
  return (
    <div className="sg-invite"><input type="text" value={name} placeholder="Member's name" onChange={(e) => setName(e.target.value)} aria-label="Member's name" />
      {["ABSENT", "EXCUSED"].map((st) => <button key={st} type="button" disabled={!name.trim()} onClick={async () => { const r = await doIt({ action: "attendance.mark", sessionId: s.id, name, status: st }, { ok: `Recorded as ${st.toLowerCase()}.`, key: "asm:mark" }); if (!r.failed) setName(""); }}>{st === "ABSENT" ? "Absent" : "Excused"}</button>)}</div>
  );
}

export default function SugAssembly() {
  const { d, load, loadFailed } = useLive("/api/sug/assembly", 5000), doIt = useDo("/api/sug/assembly", load);
  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Loader label="Opening the Assembly" />;
  if (!d.active) return <div className="sg-stack"><Note tone="info" title="The Assembly is not sitting">There is no government in office. The Assembly sits once a government has taken office, and only during its term.</Note></div>;
  const r = d.roles, open = d.open, queue = d.items.filter((i) => ["SUBMITTED"].includes(i.status));
  return (
    <div className="sg-stack">
      <div className="sg-banner" data-stage="ACTIVE"><small>Student Representative Assembly</small><h2>{open ? "In session" : "Not sitting"}</h2>
        <p>{d.seated} members seated · quorum {d.quorum}. {d.rules.quorumText}</p></div>
      {open && !d.myAttendance && d.can.attend ? <button type="button" className="go sg-cta" onClick={() => doIt({ action: "attend", sessionId: open.id }, { ok: "You are recorded present.", key: "asm:attend" })}>Record my attendance</button> : null}
      {open && d.myAttendance ? <Note tone="good" title="You are present">{d.present.length} present: {d.present.join(", ")}.</Note> : null}
      <Floor d={d} doIt={doIt} />
      <Chair d={d} doIt={doIt} />
      {r.clerk ? <Section title="Clerk" hint="Records attendance, registers submissions and publishes minutes. The Clerk cannot vote or change an outcome.">
        <Schedule doIt={doIt} />
        {queue.map((i) => <Item key={i.id} i={i} d={d} doIt={doIt}><button type="button" onClick={() => doIt({ action: "item.register", itemId: i.id }, { ok: "Registered on the order paper.", key: `asm:reg:${i.id}` })}>Register on the order paper</button></Item>)}
        {open ? <Mark s={open} doIt={doIt} /> : null}
        {d.sessions.filter((s) => s.status === "CLOSED" && !s.minutes).map((s) => <div key={s.id}><b>{s.title}</b><Minutes s={s} doIt={doIt} /></div>)}
      </Section> : null}
      {r.member ? <Submit doIt={doIt} /> : null}
      <Section title="Sittings">
        {d.sessions.length ? d.sessions.map((s) => (
          <div className="sg-msg" key={s.id}><b>{s.title}</b><small>{when(s.scheduledAt)} · {s.status.toLowerCase()}{s.status !== "SCHEDULED" ? ` · ${s.present} present` : ""}</small>
            {s.agenda ? <p>{s.agenda}</p> : null}{s.minutes ? <details><summary>Minutes</summary><p className="sg-pre">{s.minutes}</p></details> : null}
            {r.clerk && s.status === "SCHEDULED" ? <button type="button" onClick={() => doIt({ action: "session.cancel", sessionId: s.id }, { ok: "Sitting cancelled.", key: `asm:cancel:${s.id}` })}>Cancel</button> : null}
            {s.status === "SCHEDULED" && (r.speaker || r.deputy) ? <button type="button" className="go" onClick={() => doIt({ action: "session.open", sessionId: s.id }, { ok: "The sitting is open.", key: `asm:open:${s.id}` })}>Open the sitting</button> : null}
          </div>
        )) : <Empty>No sittings yet.</Empty>}
      </Section>
      <Section title="Bills and motions" hint="Numbered when the Clerk registers them. Outcomes come from the votes of the members.">
        {d.items.length ? d.items.map((i) => <Item key={i.id} i={i} d={d} doIt={doIt}>{i.mine && ["SUBMITTED", "REGISTERED"].includes(i.status) ? <button type="button" onClick={() => doIt({ action: "item.withdraw", itemId: i.id }, { ok: "Withdrawn.", key: `asm:wd:${i.id}` })}>Withdraw</button> : null}</Item>) : <Empty>Nothing has been submitted.</Empty>}
      </Section>
      <Section title="Attendance record" hint="Sittings attended by each member this term.">
        {d.attendanceRecord.length ? <ul className="sg-rows">{d.attendanceRecord.map((a) => <li key={a.name}><span className="sg-rname"><b>{a.name}</b></span><span className="sg-rv"><b>{a.present}</b><small>present</small></span><span className="sg-rv"><b>{a.absent}</b><small>absent</small></span></li>)}</ul> : <Empty>No sitting has been held yet.</Empty>}
      </Section>
    </div>
  );
}