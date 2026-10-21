// components/apps/SugAdmin.js: the Admin tab of the SUG app. Shown only to application administrators (the server answers 404 to anyone else).
// An administrator can start or cancel an election, disqualify a candidate before voting, and trigger the count. There is no control here that
// edits a ballot, a vote total or a result, because the server has no such function.
"use client";
import { useState } from "react";
import { confirmAction, askText } from "@/lib/confirm";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import { useLive, useDo, when, Note, Empty, Section } from "./sugKit";

export default function SugAdmin() {
  const { d, load, loadFailed } = useLive("/api/admin/sug", 20000), doIt = useDo("/api/admin/sug", load);
  const [title, setTitle] = useState(""), [cid, setCid] = useState("");
  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Loader label="Loading administration" />;
  const live = d.cycles.find((c) => c.status === "LIVE");
  async function start() {
    if (!(await confirmAction({ title: "Start a new election?", message: "It is announced to everyone and follows the standard timetable. Only one election can run at a time.", confirmLabel: "Start election" }))) return;
    const r = await doIt({ action: "start", title }, { ok: "The election has been announced.", key: "adm:start" });
    if (!r.failed) setTitle("");
  }
  async function cancel() {
    const reason = await askText({ title: "Cancel this election?", label: "Reason (kept in the audit log)", required: true, confirmLabel: "Cancel election", maxLength: 300 });
    if (reason === null) return;
    await doIt({ action: "cancel", id: live.id, reason }, { ok: "The election is cancelled.", key: "adm:cancel" });
  }
  async function dq() {
    if (!/^\d+$/.test(cid)) return;
    const reason = await askText({ title: "Disqualify this candidate?", label: "Reason (at least 10 characters, kept in the audit log)", required: true, confirmLabel: "Disqualify", maxLength: 300 });
    if (reason === null) return;
    const r = await doIt({ action: "disqualify", candidateId: Number(cid), reason }, { ok: "The candidate is disqualified.", key: "adm:dq" });
    if (!r.failed) setCid("");
  }
  return (
    <div className="sg-stack">
      <Note tone="info" title="Election administration">You can run the schedule and enforce the rules. You cannot see who anyone voted for, and you cannot change a ballot, a count or a result. Every action here is written to the audit log.</Note>
      {live ? (
        <Section title={`Election ${live.number}: ${live.stageLabel}`}>
          <p className="sg-hint">{live.candidates} candidates · {live.ballots} ballots cast so far.</p>
          <div className="sg-actions"><button type="button" onClick={() => doIt({ action: "run" }, { ok: "Checked the schedule.", key: "adm:run" })}>Advance the schedule now</button><button type="button" className="danger" onClick={cancel}>Cancel election</button></div>
          <div className="sg-invite"><select value={cid} onChange={(e) => setCid(e.target.value)} aria-label="Candidate to disqualify"><option value="">Choose a candidate</option>{d.standing.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.title}</option>)}</select><button type="button" disabled={!cid} onClick={dq}>Disqualify</button></div>
        </Section>
      ) : (
        <div className="sg-card sg-form"><h4>Start an election</h4>
          <label>Name (optional)<input type="text" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></label>
          <button type="button" className="go" onClick={start}>Announce election</button></div>
      )}
      <Section title="Elections">
        {d.cycles.length ? d.cycles.map((c) => <div className="sg-msg" key={c.id}><b>Election {c.number}{c.title ? ` · ${c.title}` : ""}</b><small>{c.status.toLowerCase()} · {c.stageLabel} · {c.candidates} candidates · {c.ballots} ballots · announced {when(c.timetable.announcedAt)}</small></div>) : <Empty>No election has been held.</Empty>}
      </Section>
    </div>
  );
}
