// components/admin/Online.js — who is in the game right now. Refreshes itself every 8 seconds; the state comes from heartbeats and sockets, not "recently active".
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, PageHead, Async, Table, Search, Seg, Person, PresenceBadge, Note, Stat, Empty, kobo, koboShort, ago, int } from "./kit";

const SRC = { socket: "chat connection", heartbeat: "map/building heartbeat", request: "recent request" };

export default function Online() {
  const q = useApi("online", {}, { every: 8000 }), router = useRouter(), [f, setF] = useState("LIVE"), [text, setText] = useState(""), [sort, setSort] = useState(["presence", "asc"]);
  const d = q.data, counts = d?.counts ?? {};
  const rows = useMemo(() => {
    let r = d?.players ?? [];
    if (f === "LIVE") r = r.filter((p) => p.presence !== "OFFLINE"); else if (f !== "ALL") r = r.filter((p) => p.presence === f);
    const t = text.trim().toLowerCase(); if (t) r = r.filter((p) => `${p.name} ${p.publicId} ${p.characterId} ${p.location ?? ""} ${p.faculty ?? ""}`.toLowerCase().includes(t));
    const [k, dir] = sort, m = dir === "asc" ? 1 : -1, ord = { ONLINE: 0, IDLE: 1, DISCONNECTED: 2, OFFLINE: 3 };
    const val = { presence: (p) => ord[p.presence], name: (p) => p.name.toLowerCase(), balance: (p) => { try { return Number(BigInt(p.balance) / 100n); } catch { return 0; } }, active: (p) => +new Date(p.lastActiveAt ?? 0), level: (p) => p.level }[k];
    return [...r].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * m);
  }, [d, f, text, sort]);
  return (
    <>
      <PageHead title="Online players" sub="Presence is read from live heartbeats and the chat connection. Being recently active alone never counts as online.">
        <span className="live" data-off={q.error ? "" : undefined} role="status"><i />{q.error ? "Connection problem, retrying" : d ? `Live · updated ${ago(d.at)}` : "Connecting…"}</span>
      </PageHead>
      {d && !d.realtime.connected && <Note tone="warn"><b>Realtime server not reachable.</b> Players can be Online (heartbeats) or Disconnected, but the Idle state, which needs an open chat connection, cannot be detected until REALTIME_URL points at the running realtime server.</Note>}
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat label="Online" value={int(counts.ONLINE ?? 0)} sub="active heartbeat or request" /><Stat label="Idle" value={int(counts.IDLE ?? 0)} sub="connected, not doing anything" />
        <Stat label="Disconnected" value={int(counts.DISCONNECTED ?? 0)} sub="signal within 15 min, gone quiet" /><Stat label="Seen in last 15 min" value={int(d?.players.length ?? 0)} sub={d?.realtime.connected ? `${d.realtime.sockets} sockets open` : "sockets unknown"} />
      </div>
      <div className="toolbar">
        <Seg value={f} onChange={setF} label="Presence filter" options={[["LIVE", "Live", (counts.ONLINE ?? 0) + (counts.IDLE ?? 0) + (counts.DISCONNECTED ?? 0)], ["ONLINE", "Online", counts.ONLINE ?? 0], ["IDLE", "Idle", counts.IDLE ?? 0], ["DISCONNECTED", "Disconnected", counts.DISCONNECTED ?? 0], ["ALL", "All recent"]]} />
        <Search value={text} onChange={setText} placeholder="Filter by username, id, location…" />
      </div>
      <Async q={q} rows={8}>{d && <Table
        rows={rows} rowKey={(r) => r.characterId} sort={sort[0]} dir={sort[1]} onSort={(k, dir) => setSort([k, dir])} onRow={(r) => router.push(`/admin/players/${r.userId}`)}
        empty={<Empty title="Nobody matches">{f === "LIVE" ? "No one has a live signal right now." : "Try a different filter."}</Empty>}
        columns={[
          { key: "name", label: "Player", sort: "name", render: (r) => <Person name={r.name} sub={`id ${r.publicId} · ${r.class} ${r.level}L`} /> },
          { key: "presence", label: "Status", sort: "presence", render: (r) => <span title={`Evidence: ${r.sources.map((s) => SRC[s] ?? s).join(", ") || "none"}`}><PresenceBadge v={r.presence} />{r.accountStatus !== "ACTIVE" && <> <span className="badge bad plain">{r.accountStatus === "DELETED" ? "Archived" : "Suspended"}</span></>}</span> },
          { key: "location", label: "Location", render: (r) => <span>{r.location ?? "—"}{r.conditions.length > 0 && <small className="mut" style={{ display: "block" }}>{r.conditions.join(" · ")}</small>}</span> },
          { key: "active", label: "Last activity", sort: "active", render: (r) => ago(r.lastActiveAt) },
          { key: "registered", label: "Created", render: (r) => new Date(r.registeredAt).toLocaleDateString("en-NG", { dateStyle: "medium" }) },
          { key: "balance", label: "Balance", n: true, sort: "balance", render: (r) => <span title={kobo(r.balance)}>{koboShort(r.balance)}</span> },
          { key: "stats", label: "Health · Energy · Mood", render: (r) => <span className="num mut">{r.health} · {r.energy} · {r.happiness}</span> },
        ]} />}</Async>
    </>
  );
}
