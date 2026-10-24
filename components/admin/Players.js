// components/admin/Players.js — every account ever created (including suspended, archived and character-less ones), with search, filters, sort, paging and CSV export.
"use client";
import { useRouter } from "next/navigation";
import { DownloadSimple } from "@phosphor-icons/react";
import { useApi, useDebounced, useQueryState, PageHead, Async, Table, Pager, Search, Select, Input, Seg, Person, PresenceBadge, StatusBadge, Badge, Note, Stat, kobo, koboShort, ago, day, int, qs, Card } from "./kit";
import { useState } from "react";

const STATUSES = [["", "Any status"], ["ACTIVE", "Active"], ["SUSPENDED", "Suspended"], ["DELETED", "Archived (deleted)"], ["NO_CHARACTER", "No character yet"], ["EXPELLED", "Expelled"], ["JAILED", "In custody"], ["GRADUATED", "Graduated"]];
const SEGS = [["", "Everyone"], ["early", "Early players"], ["recent", "Registered this week"], ["returning", "Returning"], ["inactive", "Inactive"], ["active", "Played recently"]];

export default function Players() {
  const [f, set] = useQueryState({ q: "", status: "", class: "", level: "", presence: "", segment: "", registeredFrom: "", registeredTo: "", sort: "registeredAt", dir: "desc", page: 1 });
  const q = useDebounced(f.q, 300), params = { ...f, q }, data = useApi("players", params, { every: 30000 }), sum = useApi("players/summary"), router = useRouter(), [emails, setEmails] = useState(false);
  const d = data.data, s = sum.data;
  const exportHref = `/api/admin/console/players/export${qs({ ...params, page: "", emails: emails ? "1" : "" })}`;
  return (
    <>
      <PageHead title="All players" sub="Every account since launch, including suspended, expelled and deleted (archived) ones.">
        <label className="mut" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={emails} onChange={(e) => setEmails(e.target.checked)} />Include emails in export</label>
        <a className="btn pri" href={exportHref} download><DownloadSimple size={16} />Export CSV</a>
      </PageHead>
      {s && <>
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <Stat label="Accounts" value={int(s.total)} sub={`${int(s.withCharacter)} with a character`} /><Stat label="Registered 7d / 30d" value={`${int(s.registered7d)} / ${int(s.registered30d)}`} sub={`first account ${day(s.firstAccountAt)}`} />
          <Stat label="Suspended" value={int(s.suspended)} /><Stat label="Deleted (archived)" value={int(s.deleted)} sub={`${int(s.noCharacter)} never made a character`} />
        </div>
        <Note><b>History coverage.</b> {s.coverage}</Note>
      </>}
      <div className="toolbar">
        <Search value={f.q} onChange={(v) => set({ q: v })} placeholder="Username, email, player id or short id…" />
      </div>
      <Card className="" title="Filters">
        <div className="row">
          <Select label="Status" value={f.status} onChange={(v) => set({ status: v })} options={STATUSES} />
          <Select label="Class" value={f.class} onChange={(v) => set({ class: v })} options={[["", "Any"], "NEPO", "MAPO", "LAPO"]} />
          <Select label="Level" value={f.level} onChange={(v) => set({ level: v })} options={[["", "Any"], ...[100, 200, 300, 400, 500].map((l) => [String(l), `${l}L`])]} />
          <Select label="Presence" value={f.presence} onChange={(v) => set({ presence: v })} options={[["", "Any"], ["ONLINE", "Online"], ["IDLE", "Idle"], ["DISCONNECTED", "Disconnected"], ["OFFLINE", "Offline"]]} />
          <Select label="Segment" value={f.segment} onChange={(v) => set({ segment: v })} options={SEGS} hint={f.segment && s?.segments?.[f.segment]} />
          <Input label="Registered from" type="date" value={f.registeredFrom} onChange={(e) => set({ registeredFrom: e.target.value })} />
          <Input label="Registered to" type="date" value={f.registeredTo} onChange={(e) => set({ registeredTo: e.target.value })} />
        </div>
      </Card>
      <div style={{ height: 14 }} />
      <Async q={data} rows={9}>{d && <>
        <Table rows={d.rows} rowKey={(r) => r.userId} loading={data.loading} sort={f.sort} dir={f.dir} onSort={(sort, dir) => set({ sort, dir })} onRow={(r) => router.push(`/admin/players/${r.userId}`)}
          columns={[
            { key: "reg", label: "#", sort: "regNo", n: true, render: (r) => <span className="mut num">{r.regNo}</span> },
            { key: "name", label: "Player", sort: "name", render: (r) => <Person name={r.name} sub={r.hasCharacter ? `id ${r.publicId} · ${r.class} · ${r.level}L${r.faculty ? " · " + r.faculty : ""}` : r.emailMasked} /> },
            { key: "status", label: "Account", render: (r) => <span className="chips"><StatusBadge v={r.status} />{r.isAdmin && <Badge tone="info" plain>Admin</Badge>}{r.conditions?.map((c) => <Badge key={c} tone="warn" plain>{c}</Badge>)}</span> },
            { key: "presence", label: "Presence", render: (r) => <PresenceBadge v={r.presence} /> },
            { key: "registered", label: "Created", sort: "registeredAt", render: (r) => day(r.registeredAt) },
            { key: "last", label: "Last activity", sort: "lastActivity", render: (r) => <span title={r.lastLoginAt ? `Last login ${ago(r.lastLoginAt)}` : "No login recorded"}>{ago(r.lastActivity)}</span> },
            { key: "bal", label: "Balance", n: true, sort: "balance", render: (r) => r.balance == null ? "—" : <span title={kobo(r.balance)}>{koboShort(r.balance)}</span> },
            { key: "act", label: "Actions 30d", n: true, sort: "actions30", render: (r) => int(r.actions30) },
          ]} />
        <Pager d={d} onPage={(page) => set({ page })} noun="accounts" />
      </>}</Async>
    </>
  );
}
