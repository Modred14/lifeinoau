// components/admin/Audit.js — every administrator action, successful or failed. Failed attempts are kept so they can be investigated.
"use client";
import { useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { useApi, useDebounced, useQueryState, PageHead, Card, Async, Table, Pager, Search, Seg, Select, Input, Badge, Note, Modal, Btn, Empty, qs, ago, when, int } from "./kit";

export default function Audit() {
  const init = typeof window !== "undefined" ? Object.fromEntries(new URLSearchParams(window.location.search)) : {};
  const [f, set] = useQueryState({ status: init.status ?? "", action: "", actor: "", target: "", q: "", from: "", to: "", page: 1 }), q = useDebounced(f.q), actor = useDebounced(f.actor), target = useDebounced(f.target);
  const params = { ...f, q, actor, target }, data = useApi("audit", params, { every: 30000 }), acts = useApi("audit/actions"), [open, setOpen] = useState(null), d = data.data;
  return (<><PageHead title="Audit log" sub="Who did what, to whom, when, and whether it worked.">
    <a className="btn pri" href={`/api/admin/console/audit/export${qs({ ...params, page: "" })}`} download><DownloadSimple size={16} />Export CSV</a></PageHead>
    <div className="toolbar"><Seg value={f.status} onChange={(v) => set({ status: v })} label="Outcome" options={[["", "All", d?.allTime], ["OK", "Succeeded"], ["FAILED", "Failed", d?.failedTotal]]} /><Search value={f.q} onChange={(v) => set({ q: v })} placeholder="Search inside the details (reason, amounts, names)…" /></div>
    <Card><div className="row"><Select label="Action" value={f.action} onChange={(v) => set({ action: v })} options={[["", "Any action"], ...(acts.data?.actions ?? []).map((a) => [a.action, `${a.action} (${a.n})`])]} />
      <Input label="Administrator" value={f.actor} onChange={(e) => set({ actor: e.target.value })} placeholder="username" /><Input label="Target player" value={f.target} onChange={(e) => set({ target: e.target.value })} placeholder="username or id" />
      <Input label="From" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /><Input label="To" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></div></Card>
    <div style={{ height: 14 }} />
    <Async q={data} rows={8}>{d && <>{d.failedTotal > 0 && f.status !== "FAILED" && <Note tone="warn"><b>{int(d.failedTotal)} failed admin action{d.failedTotal === 1 ? "" : "s"} on record.</b> <button className="btn sm" onClick={() => set({ status: "FAILED" })}>Show only failures</button></Note>}
      <Table rows={d.rows} rowKey={(r) => r.id} loading={data.loading} onRow={(r) => setOpen(r.id)} empty={<Empty title="No entries">Nothing matches these filters.</Empty>} columns={[
        { key: "at", label: "Time", render: (r) => <span title={when(r.at)}>{ago(r.at)}</span> }, { key: "who", label: "Administrator", render: (r) => r.actor ?? r.actorId }, { key: "a", label: "Action", render: (r) => <span className="mono">{r.action}</span> }, { key: "t", label: "Target", render: (r) => r.targetName ?? r.target ?? "—" },
        { key: "s", label: "Outcome", render: (r) => r.status === "FAILED" ? <Badge tone="bad">Failed</Badge> : <Badge tone="ok" plain>OK</Badge> }, { key: "d", label: "Detail", wrap: true, render: (r) => <span className="mut">{r.error ?? r.detail?.reason ?? r.detail?.message ?? ""}</span> }]} />
      <Pager d={d} onPage={(page) => set({ page })} noun="entries" /></>}</Async>
    {open && <Entry id={open} onClose={() => setOpen(null)} onOpen={setOpen} />}</>);
}
function Entry({ id, onClose, onOpen }) {
  const q = useApi("audit/entry", { id }), e = q.data?.entry;
  return <Modal wide title={e ? e.action : "Log entry"} sub={e && `${when(e.at)} · ${e.actor ?? e.actorId}${e.targetName ? " → " + e.targetName : ""}`} onClose={onClose}>
    <Async q={q} rows={4}>{e && <>
      {e.status === "FAILED" && <Note tone="bad"><b>This action failed.</b> {e.error}. Nothing was changed. Retrying with the same request id is safe.</Note>}
      <dl className="kv"><dt>Outcome</dt><dd>{e.status}</dd><dt>Request id</dt><dd className="mono">{e.requestId ?? "none (read only)"}</dd><dt>Administrator</dt><dd>{e.actor} <span className="mono mut">{e.actorId}</span></dd><dt>Target</dt><dd>{e.targetName ?? "—"} <span className="mono mut">{e.target}</span></dd></dl>
      <pre className="mono">{JSON.stringify(e.detail, null, 2) ?? "no details"}</pre>
      {q.data.around?.length > 1 && <Card title="Other entries for the same target"><Table cards={false} rows={q.data.around.filter((x) => x.id !== e.id)} rowKey={(r) => r.id} onRow={(r) => onOpen(r.id)} columns={[{ key: "at", label: "When", render: (r) => ago(r.at) }, { key: "a", label: "Action", render: (r) => <span className="mono">{r.action}</span> }, { key: "s", label: "", render: (r) => r.status === "FAILED" ? <Badge tone="bad">Failed</Badge> : null }]} /></Card>}</>}</Async></Modal>;
}
