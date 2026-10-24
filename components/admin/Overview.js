// components/admin/Overview.js — the front page: real numbers only, each with its definition one click away.
"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowsClockwise, Info } from "@phosphor-icons/react";
import { useApi, PageHead, Card, Stat, Async, Btn, Seg, Table, Badge, Person, kobo, koboShort, int, ago, when, Empty, Note } from "./kit";
import { DayBars, HBars } from "./charts";

export default function Overview() {
  const [days, setDays] = useState("30"), q = useApi("overview", { days }, { every: 30000 }), router = useRouter(), [defs, setDefs] = useState(false);
  const d = q.data;
  return (
    <>
      <PageHead title="Overview" sub={d ? `Updated ${ago(d.generatedAt)} · game week ${d.week ?? "—"}` : "Loading the current state of the game…"}>
        <Seg value={days} onChange={setDays} label="Chart range" options={[["7", "7 days"], ["30", "30 days"], ["90", "90 days"]]} />
        <Btn onClick={() => q.reload()} busy={q.loading && !!d}><ArrowsClockwise size={15} />Refresh</Btn>
      </PageHead>
      <Async q={q} rows={8}>{d && <div className="stack">
        {!d.health.ledger.ok && <Note tone="bad"><b>Ledger check failed.</b> {d.health.ledger.mismatches.length ? `${d.health.ledger.mismatches.length} player balance(s) differ from their ledger history.` : ""} {!d.health.ledger.businessPoolOk && "The business pool does not match business capital."} Open the Economy page before making further balance changes.</Note>}
        <div className="grid g4">
          <Stat label="Online now" value={int(d.online.ONLINE)} sub={`${int(d.online.IDLE)} idle · ${int(d.online.DISCONNECTED)} disconnected`} />
          <Stat label="Accounts ever created" value={int(d.players.accounts)} sub={`${int(d.players.withCharacter)} with a character · ${int(d.players.archived)} archived`} />
          <Stat label="Active today / week / month" value={`${int(d.players.dau)} / ${int(d.players.wau)} / ${int(d.players.mau)}`} sub="DAU / WAU / MAU, by recorded game actions" />
          <Stat label="New this week" value={int(d.players.newThisWeek)} sub={`${int(d.players.returning)} returning · ${int(d.players.inactive)} inactive`} />
          <Stat label="Money in player accounts" value={koboShort(d.economy.totalKobo)} title={kobo(d.economy.totalKobo)} sub={`median ${koboShort(d.economy.medianKobo)} · richest ${koboShort(d.economy.maxKobo)}`} />
          <Stat label="Restrictions in force" value={int(d.players.suspended + d.moderation.academicSuspended + d.moderation.expelled + d.moderation.jailed)} sub={`${int(d.players.suspended)} suspended · ${int(d.moderation.expelled)} expelled · ${int(d.moderation.jailed)} in custody`} />
          <Stat label="Open reports" value={int(d.moderation.openReports)} tone={d.moderation.openReports ? "hot" : ""} sub={`${int(d.moderation.actions7d)} moderation actions in 7 days`} />
          <Stat label="Failed admin actions (24h)" value={int(d.health.failedAdminOps.last24h)} tone={d.health.failedAdminOps.last24h ? "bad" : ""} sub={`${int(d.health.failedAdminOps.last7d)} in 7 days`} />
        </div>
        <div className="grid g2">
          <Card title="New accounts per day"><DayBars data={d.registrations} label="New accounts" /></Card>
          <Card title="Players who acted per day"><DayBars data={d.activeByDay} color="var(--a-ok)" label="Active players" /></Card>
        </div>
        <div className="grid g-main">
          <Card title="Wealth distribution (player balances)" right={<Link href="/admin/economy" className="mut">Economy →</Link>}>
            <HBars rows={d.economy.distribution.map((b) => ({ label: b.label, value: b.players, text: int(b.players), title: `${b.players} players hold ${kobo(b.sumKobo)} in total` }))} />
            {d.economy.wealthy.some((w) => w.unusual) && <Note tone="warn">Unusual balances: {d.economy.wealthy.filter((w) => w.unusual).map((w) => `${w.name} (${koboShort(w.balance)})`).join(", ")}. Inspect them under Economy → Suspicious.</Note>}
          </Card>
          <Card title="System health">
            <dl className="kv">
              <dt>Database</dt><dd><Badge tone="ok">Reachable</Badge> <span className="mut">{d.health.database.latencyMs} ms for this page</span></dd>
              <dt>Ledger</dt><dd>{d.health.ledger.ok ? <Badge tone="ok">Balanced</Badge> : <Badge tone="bad">Mismatch</Badge>} <span className="mut">{int(d.health.ledger.entries)} entries</span></dd>
              <dt>Realtime server</dt><dd>{d.health.realtime.connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="warn">Not reachable</Badge>} <span className="mut">{d.health.realtime.connected ? `${d.health.realtime.sockets} open sockets` : "Idle detection is off"}</span></dd>
              <dt>Failed admin ops</dt><dd><Link href="/admin/audit?status=FAILED">{int(d.health.failedAdminOps.last24h)} in 24h</Link></dd>
            </dl>
          </Card>
        </div>
        <div className="grid g2">
          <Card title="Forbes OAU top 5" right={<Link href="/admin/forbes" className="mut">Manage →</Link>}>
            {d.forbes.length ? <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>{d.forbes.map((f) => <li key={f.name} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span><b className="num">#{f.rank}</b> <Person name={f.name} sub={`${f.class} · ${f.faculty}`} /></span><b className="num" title={kobo(f.value)}>{koboShort(f.value)}</b></li>)}</ol> : <Empty title="The board is empty" />}
          </Card>
          <Card title="Busiest actions, last 24 hours">
            {d.gameNow.length ? <HBars color="var(--a-info)" rows={d.gameNow.map((g) => ({ label: g.action, value: g.n, text: int(g.n) }))} /> : <Empty title="No game actions in 24 hours" />}
          </Card>
        </div>
        <div className="grid g2">
          <Card title="Recent transactions" right={<Link href="/admin/economy" className="mut">All →</Link>}>
            <Table cards={false} columns={[{ key: "t", label: "Time", render: (r) => ago(r.createdAt) }, { key: "p", label: "From → to", render: (r) => <span>{r.from} → {r.to}</span> }, { key: "a", label: "Amount", n: true, render: (r) => <span title={kobo(r.amount)}>{koboShort(r.amount)}</span> }]} rows={d.recentTransactions} empty={<Empty title="No transactions yet" />} />
          </Card>
          <Card title="Recent admin actions" right={<Link href="/admin/audit" className="mut">Audit log →</Link>}>
            <Table cards={false} columns={[{ key: "t", label: "Time", render: (r) => ago(r.createdAt) }, { key: "a", label: "Action", render: (r) => <span className="mono">{r.action}</span> }, { key: "w", label: "By → target", render: (r) => `${r.actor ?? "?"}${r.target ? " → " + r.target : ""}` }, { key: "s", label: "", render: (r) => r.status === "FAILED" ? <Badge tone="bad">Failed</Badge> : null }]} rows={d.recentAdmin} onRow={() => router.push("/admin/audit")} empty={<Empty title="No admin actions yet" />} />
          </Card>
        </div>
        <Card title="How these numbers are defined" right={<Btn size="sm" tone="ghost" onClick={() => setDefs(!defs)}><Info size={14} />{defs ? "Hide" : "Show"}</Btn>}>
          {defs ? <dl className="kv">{Object.entries(d.definitions).map(([k, v]) => <Fragment key={k}><dt style={{ textTransform: "capitalize" }}>{k}</dt><dd>{v}</dd></Fragment>)}</dl> : <p className="mut">Every figure comes straight from the database; nothing is sampled or estimated. Open this for the exact meaning of online, active, returning and inactive.</p>}
        </Card>
      </div>}</Async>
    </>
  );
}
