// components/admin/Moderation.js — reports, current restrictions, moderation history, and a place to act on any player.
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, useDebounced, useQueryState, PageHead, Card, Async, Table, Pager, Search, Seg, Tabs, Person, Badge, StatusBadge, Note, Btn, Empty, PlayerPicker, Modal, Area, kobo, ago, when, int, act } from "./kit";
import { PlayerActions, actionPlayer } from "./Actions";

export default function Moderation() {
  const [tab, setTab] = useState("reports");
  return (<><PageHead title="Moderation" sub="Reports, who is restricted and why, what was done, and tools to act on any player." />
    <Tabs value={tab} onChange={setTab} options={[["reports", "Reports"], ["restrictions", "Restrictions"], ["history", "History"], ["act", "Act on a player"]]} />
    {tab === "reports" && <Reports />}{tab === "restrictions" && <Restrictions />}{tab === "history" && <History />}{tab === "act" && <ActOn />}</>);
}

function Reports() {
  const [status, setStatus] = useState("OPEN"), [page, setPage] = useState(1), q = useApi("moderation/reports", { status, page }), d = q.data, [open, setOpen] = useState(null);
  return <><div className="toolbar"><Seg value={status} onChange={(s) => { setStatus(s); setPage(1); }} label="Status" options={[["OPEN", "Open"], ["ACTIONED", "Actioned"], ["DISMISSED", "Dismissed"]]} /></div>
    <Async q={q} rows={5}>{d && <>{d.rows.length ? <><Table rows={d.rows} rowKey={(r) => r.id} columns={[
      { key: "at", label: "Filed", render: (r) => ago(r.createdAt) }, { key: "t", label: "Reported player", render: (r) => <Person name={r.target} /> }, { key: "r", label: "By", render: (r) => r.reporter },
      { key: "why", label: "Reason", wrap: true, render: (r) => r.reason }, { key: "a", label: "", render: (r) => <Btn size="sm" tone={r.status === "OPEN" ? "pri" : ""} onClick={() => setOpen(r)}>{r.status === "OPEN" ? "Review" : "View"}</Btn> }]} /><Pager d={d} onPage={setPage} noun="reports" /></>
      : <Empty title={status === "OPEN" ? "No open reports" : "Nothing here"}>{status === "OPEN" ? "Players have not reported anyone that is still waiting for a decision." : ""}</Empty>}</>}</Async>
    {open && <ReportModal r={open} onClose={() => setOpen(null)} onDone={() => q.reload()} />}</>;
}
function ReportModal({ r, onClose, onDone }) {
  const m = useApi("moderation/report-messages", { id: r.id }), [note, setNote] = useState(""), [busy, setBusy] = useState(""), router = useRouter();
  async function decide(action) {
    setBusy(action); const x = await act("moderation/resolve-report", { id: r.id, action, note: note.trim() }, { pending: "Saving decision…", success: "Report handled." }); setBusy("");
    if (!x.failed) { onDone(); onClose(); }
  }
  return <Modal wide title={`Report against ${r.target}`} sub={`Filed by ${r.reporter} · ${when(r.createdAt)}`} onClose={onClose} footer={r.status === "OPEN" ? <>
    <Btn onClick={() => router.push(`/admin/players/${r.targetId}`)}>Open player file</Btn><Btn busy={busy === "dismiss"} disabled={note.trim().length < 5} onClick={() => decide("dismiss")}>Dismiss</Btn>
    <Btn busy={busy === "actioned"} disabled={note.trim().length < 5} onClick={() => decide("actioned")}>Mark as warned</Btn><Btn tone="solid-danger" busy={busy === "suspend"} disabled={note.trim().length < 5} onClick={() => decide("suspend")}>Suspend 2 hours</Btn></> : null}>
    <p><b>Reason given:</b> {r.reason}</p>
    <Card title="Conversation evidence (last 20 messages, opening this is logged)"><Async q={m} rows={4}>{m.data && (m.data.messages.length ? <div style={{ display: "grid", gap: 6 }}>{m.data.messages.map((x, i) => <div key={i} style={{ display: "flex", gap: 10 }}><b style={{ minWidth: 80 }} className={x.fromReporter ? "mut" : "warn"}>{x.fromReporter ? r.reporter : r.target}</b><span style={{ overflowWrap: "anywhere" }}>{x.body}</span></div>)}</div> : <Empty title="No messages saved" />)}</Async></Card>
    {r.status === "OPEN" && <Area label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} hint="Recorded in the audit log. At least 5 characters." maxLength={300} data-autofocus />}
  </Modal>;
}

const KINDS = [["", "All"], ["account", "Account"], ["suspended", "Suspended"], ["deleted", "Deleted"], ["academic", "Academic suspension"], ["expelled", "Expelled"], ["custody", "In custody"]];
function Restrictions() {
  const [f, set] = useQueryState({ kind: "", q: "", page: 1 }), q = useDebounced(f.q), data = useApi("moderation/restrictions", { ...f, q }), d = data.data, router = useRouter();
  return <><div className="toolbar"><Seg value={f.kind} onChange={(v) => set({ kind: v })} label="Kind" options={KINDS} /><Search value={f.q} onChange={(v) => set({ q: v })} placeholder="Username or email…" /></div>
    <Async q={data} rows={5}>{d && <><Table rows={d.rows} rowKey={(r) => r.userId} loading={data.loading} onRow={(r) => router.push(`/admin/players/${r.userId}`)} empty={<Empty title="Nobody is restricted">No account matches.</Empty>} columns={[
      { key: "n", label: "Player", render: (r) => <Person name={r.name} /> }, { key: "r", label: "Restrictions", render: (r) => <span className="chips">{r.restrictions.map((x, i) => <Badge key={i} tone={x.kind === "Archived" || x.kind === "Expelled" ? "bad" : "warn"}>{x.kind}{x.until ? ` · until ${when(x.until)}` : x.kind.startsWith("Account") ? " · until restored" : ""}</Badge>)}</span> },
      { key: "w", label: "Set", render: (r) => r.setAt ? ago(r.setAt) : "—" }, { key: "why", label: "Reason", wrap: true, render: (r) => <span className="mut">{r.restrictions.find((x) => x.detail)?.detail ?? ""}</span> }]} /><Pager d={d} onPage={(page) => set({ page })} noun="players" /></>}</Async></>;
}

function History() {
  const [page, setPage] = useState(1), [player, setPlayer] = useState(null), q = useApi("moderation/history", { page, player: player?.characterId }), d = q.data;
  return <><div className="toolbar" style={{ alignItems: "end" }}><div style={{ minWidth: 260 }}><PlayerPicker value={player} onPick={(p) => { setPlayer(p); setPage(1); }} label="Only this player (optional)" /></div></div>
    <Async q={q} rows={5}>{d && <><Table rows={d.rows} rowKey={(r) => r.id} empty={<Empty title="No moderation actions yet">Suspensions, warnings, discipline and repairs will be listed here.</Empty>} columns={[
      { key: "at", label: "When", render: (r) => <span title={when(r.at)}>{ago(r.at)}</span> }, { key: "a", label: "Action", render: (r) => <span className="mono">{r.action}</span> }, { key: "t", label: "Player", render: (r) => r.targetName ?? r.target ?? "—" }, { key: "by", label: "By", render: (r) => r.actor },
      { key: "s", label: "", render: (r) => r.status === "FAILED" ? <Badge tone="bad">Failed</Badge> : <Badge tone="ok" plain>OK</Badge> }, { key: "d", label: "Detail", wrap: true, render: (r) => <span className="mut">{r.error ?? r.detail?.reason ?? r.detail?.message ?? ""}</span> }]} /><Pager d={d} onPage={setPage} noun="actions" /></>}</Async></>;
}

function ActOn() {
  const [pl, setPl] = useState(null), q = useApi("player", { ref: pl?.userId }, { skip: !pl }), d = q.data;
  return <Card title="Choose a player"><div className="stack"><PlayerPicker value={pl} onPick={setPl} hint="Search by username. Opening a player file is recorded in the audit log." />
    {pl && <Async q={q} rows={3}>{d && <><dl className="kv"><dt>Account</dt><dd><StatusBadge v={d.account.status} /></dd><dt>Balance</dt><dd>{kobo(d.balance)}</dd><dt>Level</dt><dd>{d.character?.level}L {d.character?.class}</dd></dl><PlayerActions p={actionPlayer(d)} onChange={q.reload} /></>}</Async>}</div></Card>;
}
