// components/admin/PlayerDetail.js — one account in full: identity, standing, money, Forbes, history, and every action an administrator can take.
"use client";
import Link from "next/link";
import { ArrowLeft, ArrowsClockwise } from "@phosphor-icons/react";
import { useApi, PageHead, Card, Async, Stat, Badge, StatusBadge, PresenceBadge, Table, Person, Note, Empty, Btn, kobo, koboShort, when, ago, day, int, cell, nice } from "./kit";
import { PlayerActions, actionPlayer } from "./Actions";

export default function PlayerDetail({ refId }) {
  const q = useApi("player", { ref: refId }), d = q.data; // no polling: every open of a player file is written to the audit log
  const a = d?.account, c = d?.character;
  const p = d && actionPlayer(d), future = (x) => x && +new Date(x) > Date.now();
  return (
    <>
      <div style={{ marginBottom: 10 }}><Link href="/admin/players" className="mut" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><ArrowLeft size={14} />All players</Link></div>
      <Async q={q} rows={10}>{d && <div className="stack">
        <div className="adm-head"><div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <Person name={c?.name} size={56} sub={c ? `${c.class} · ${c.level}L · id ${String(c.id).slice(-8)}` : a.email} />
          <div className="chips"><StatusBadge v={a.status} />{d.presence && <PresenceBadge v={d.presence.state} />}{a.role === "ADMIN" && <Badge tone="info">Administrator</Badge>}{d.conditions.map((x) => <Badge key={x} tone="warn" plain>{x}</Badge>)}</div></div>
          <Btn onClick={() => q.reload()} busy={q.loading}><ArrowsClockwise size={15} />Refresh</Btn></div>
        {a.status !== "ACTIVE" && <Note tone={a.status === "DELETED" ? "bad" : "warn"}><b>{a.status === "DELETED" ? "Archived (deleted) account." : "Suspended account."}</b> {a.statusReason && <>Reason: {a.statusReason}. </>}{a.statusUntil ? `Until ${when(a.statusUntil)}.` : a.status === "SUSPENDED" ? "Until an administrator restores it." : ""} {a.statusAt && `Set ${ago(a.statusAt)}.`}</Note>}
        <Card title="Actions"><PlayerActions p={p} onChange={q.reload} /></Card>
        <div className="grid g4">
          <Stat label="Balance" value={d.balance != null ? koboShort(d.balance) : "—"} title={kobo(d.balance)} sub={d.balance != null ? kobo(d.balance) : "No character"} />
          <Stat label="Forbes net worth" value={d.forbes ? koboShort(d.forbes.netWorthKobo) : "—"} title={d.forbes && kobo(d.forbes.netWorthKobo)} sub={d.forbes ? (d.forbes.excluded ? "Removed from the board" : `Rank #${d.forbes.rank}`) : ""} />
          <Stat label="Registered" value={day(a.registeredAt)} sub={`Account #${a.regNo} · ${int(a.loginCount)} logins`} />
          <Stat label="Last activity" value={ago(a.lastActivity)} sub={a.lastLoginAt ? `last login ${ago(a.lastLoginAt)}` : "no login recorded"} />
        </div>
        <div className="grid g2">
          <Card title="Account"><dl className="kv"><dt>Email</dt><dd>{a.email}</dd><dt>User id</dt><dd className="mono">{a.userId}</dd><dt>Role</dt><dd>{a.role}</dd><dt>Registered</dt><dd>{when(a.registeredAt)}</dd><dt>Status changed</dt><dd>{a.statusAt ? `${when(a.statusAt)}${a.statusBy ? " by " + a.statusBy : ""}` : "never"}</dd></dl></Card>
          {c ? <Card title="Character"><dl className="kv"><dt>Gender</dt><dd>{c.gender}</dd><dt>Class</dt><dd>{c.class}</dd><dt>Level</dt><dd>{c.level}L {c.graduated && <Badge tone="ok" plain>Graduated</Badge>}</dd><dt>Home</dt><dd>{c.hostel || "none"}</dd><dt>Job</dt><dd>{c.jobKey ?? "none"}</dd>
            <dt>Health / Energy / Mood</dt><dd className="num">{c.health} / {c.energy} / {c.happiness}</dd><dt>Academics / Popularity</dt><dd className="num">{c.academics} / {c.popularity}</dd><dt>Suspicion / Strikes</dt><dd className="num">{c.suspicion} / {c.strikes}</dd>
            <dt>Location</dt><dd>{c.placeId || "outside"}</dd><dt>Discipline</dt><dd>{p.gameSuspended ? `Suspended until ${when(c.suspendedUntil)}. ` : ""}{p.expelled ? "Expelled. " : ""}{p.jailed ? `In custody until ${when(c.jailedUntil)}.` : ""}{!p.gameSuspended && !p.expelled && !p.jailed && "none"}</dd></dl></Card>
          : <Card title="Character"><Empty title="No character yet">This account has not created a character, so there is no game data to manage.</Empty></Card>}
        </div>
        {d.forbes && <Card title="Forbes OAU"><p>{d.forbes.excluded ? "Removed from the board by an administrator. Money and progress are untouched." : `Ranked #${d.forbes.rank} by net worth.`} Net worth {kobo(d.forbes.netWorthKobo)} = cash {kobo(d.balance)} + businesses {kobo(d.forbes.businessKobo)} + investments {kobo(d.forbes.investmentsKobo)}.</p></Card>}
        <div className="grid g2">
          <Card title="Recent transactions">{d.ledger.length ? <Table cards={false} rows={d.ledger} columns={[{ key: "at", label: "When", render: (r) => ago(r.at) }, { key: "memo", label: "Memo", wrap: true, render: (r) => r.memo }, { key: "amt", label: "Amount", n: true, render: (r) => <span className={r.incoming ? "ok" : "bad"} title={kobo(r.amountKobo)}>{r.incoming ? "+" : "−"}{koboShort(r.amountKobo)}</span> }]} /> : <Empty title="No transactions" />}</Card>
          <Card title="Admin & moderation history">{d.history.length ? <Table cards={false} rows={d.history} columns={[{ key: "at", label: "When", render: (r) => ago(r.at) }, { key: "action", label: "Action", render: (r) => <span className="mono">{r.action}</span> }, { key: "s", label: "", render: (r) => r.status === "FAILED" ? <Badge tone="bad">Failed</Badge> : null }, { key: "d", label: "Detail", wrap: true, render: (r) => <span className="mut">{r.detail?.reason ?? r.detail?.message ?? ""}</span> }]} /> : <Empty title="No admin actions on this player" />}</Card>
        </div>
        <div className="grid g3">
          <Card title="Businesses">{d.businesses.length ? <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>{d.businesses.map((b) => <li key={b.id}>{b.name} <span className="mut">{b.type} · L{b.level}</span> <b className="num">{koboShort(b.capital)}</b> <Badge tone={b.status === "ACTIVE" ? "ok" : ""} plain>{b.status}</Badge></li>)}</ul> : <p className="mut">None.</p>}</Card>
          <Card title="Relationships">{d.relationships.bonds.length || d.relationships.npc.length ? <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>{d.relationships.bonds.map((b) => <li key={b.id}>{b.partner} <span className="mut">{b.kind}</span></li>)}{d.relationships.npc.map((n, i) => <li key={i}>{n.name ?? n.npc ?? "NPC"} <span className="mut">NPC</span></li>)}</ul> : <p className="mut">None.</p>}</Card>
          <Card title="Reports & blocks"><dl className="kv"><dt>Reports against</dt><dd>{d.reports.against}</dd><dt>Reports filed</dt><dd>{d.reports.filed}</dd><dt>Open</dt><dd>{d.reports.open}</dd><dt>Blocked / blocked by</dt><dd>{d.blocks.blocked} / {d.blocks.blockedBy}</dd><dt>Room items</dt><dd>{d.roomItems}</dd><dt>Cars</dt><dd>{d.cars.length}</dd></dl></Card>
        </div>
        {d.custody.length > 0 && <Card title="Custody history"><Table cards={false} rows={d.custody} columns={Object.keys(d.custody[0]).slice(0, 6).map((k) => ({ key: k, label: nice(k), render: (r) => cell(k, r[k]) }))} /></Card>}
        <p className="mut">Opening this page is recorded in the audit log.</p>
      </div>}</Async>
    </>
  );
}
