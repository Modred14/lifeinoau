// components/admin/Game.js — the game systems that actually exist, with real data and only the actions that are really supported.
"use client";
import { useState } from "react";
import { useApi, useDebounced, PageHead, Card, Async, Table, Pager, Search, Tabs, Seg, Stat, Note, Badge, Btn, Empty, Modal, Input, Select, Area, PlayerPicker, nice, cell, kobo, int, act, confirmAction, when, ago } from "./kit";

const SYSTEMS = [
  ["jobs", "Jobs", [["jobs.definitions", "Job types"], ["jobs.employment", "Employment"], ["jobs.shifts", "Shifts"]], "Job definitions, employment and shifts"],
  ["businesses", "Businesses", [["businesses", "All businesses"]], "Every business, its owner and capital"],
  ["academics", "Academics", [["academics.faculties", "Faculties"], ["academics.exams", "Exams"], ["academics.tests", "Class tests"], ["academics.status", "Standing"]], "Faculties, exams, class tests, academic standing"],
  ["hostels", "Hostels & homes", [["hostels.occupancy", "Occupancy"], ["hostels.residents", "Residents"]], "Who lives where"],
  ["relationships", "Relationships", [["relationships.bonds", "Player bonds"], ["relationships.npc", "NPC relationships"]], "Player bonds and NPC relationships"],
  ["events", "Nightclubs & parties", [["events.clubs", "Club spending"], ["events.tickets", "Tickets, VIP, buyouts"]], "Club spending, VIPs, buyouts, party tickets"],
  ["inventory", "Items & cars", [["inventory.items", "Room items"], ["inventory.cars", "Cars"]], "Room items and owned cars"],
  ["transport", "Transport", [["transport.overview", "Overview"]], "Cars sold, rides, drivers"],
  ["hustles", "Hustles & custody", [["hustles.runs", "Hustle runs"], ["hustles.custody", "Floor O custody"]], "Hustle runs, catches, custody"],
  ["matches", "Games & wagers", [["matches.list", "Matches"]], "Matches, wagers and the queue"],
  ["billboards", "Billboards", [["billboards.list", "Billboards"]], "Posters, with the admin switch-off"],
  ["elections", "SUG elections", [], "Elections, candidates and the count"],
  ["config", "Game rules", [], "Prices, rewards and limits the game runs on (read only)"],
];
const COUNT = { jobs: "employed", businesses: "activeBusinesses", academics: "exams", hostels: "housed", relationships: "liveBonds", events: "clubTransactions", inventory: "roomItems", transport: "ownedCars", hustles: "hustleRuns", matches: "activeMatches", billboards: "billboards", elections: "liveElections" };

export default function Game() {
  const [sys, setSys] = useState(null), ov = useApi("game/overview", {}, { every: 60000 }), cur = SYSTEMS.find((s) => s[0] === sys);
  return (<><PageHead title="Game systems" sub="Only systems that exist in the game. Each shows live data from the database."><Btn onClick={() => ov.reload()}>Refresh counts</Btn></PageHead>
    <Async q={ov} rows={4}>{ov.data && <>
      <div className="grid g4" style={{ marginBottom: 16 }}><Stat label="Players" value={int(ov.data.players)} sub={`${int(ov.data.graduates)} graduated`} /><Stat label="Game week" value={ov.data.week ?? "—"} /><Stat label="Active businesses" value={int(ov.data.activeBusinesses)} sub={`${kobo(ov.data.businessCapital)} capital`} /><Stat label="In custody / queued" value={`${int(ov.data.inCustody)} / ${int(ov.data.queued)}`} sub={`${int(ov.data.activeMatches)} matches running`} /></div>
      <div className="grid g4" style={{ marginBottom: 18 }}>{SYSTEMS.map(([id, title, , blurb]) => <button key={id} onClick={() => setSys(id)} aria-pressed={sys === id} className="card sys" style={{ borderColor: sys === id ? "var(--gold)" : undefined }}>
        <h2>{title}</h2><p>{blurb}</p>{COUNT[id] && <b className="num">{int(ov.data[COUNT[id]] ?? 0)}</b>}</button>)}</div></>}</Async>
    {cur && (cur[0] === "elections" ? <Elections /> : cur[0] === "config" ? <Rules /> : <System key={cur[0]} sys={cur} />)}
    {!cur && <Empty title="Choose a system">Pick one above to see its data and the actions available.</Empty>}</>);
}

function System({ sys }) {
  const [, title, views] = sys, [view, setView] = useState(views[0][0]), [text, setText] = useState(""), [page, setPage] = useState(1), q = useDebounced(text), data = useApi("game/list", { view, q, page }), d = data.data, [form, setForm] = useState(null);
  const pick = (v) => { setView(v); setPage(1); setText(""); };
  return <><Card title={title} right={view === "inventory.items" || view === "inventory.cars" ? <Btn size="sm" tone="pri" onClick={() => setForm({ kind: view === "inventory.cars" ? "car.grant" : "item.grant" })}>{view === "inventory.cars" ? "Give a car" : "Give an item"}</Btn> : null}>
    {views.length > 1 && <Tabs value={view} onChange={pick} options={views} />}
    <div className="toolbar"><Search value={text} onChange={(v) => { setText(v); setPage(1); }} placeholder="Search this list…" /></div>
    <Async q={data} rows={6}>{d && <>
      {d.note && <Note>{d.note}</Note>}<Summary d={d} />
      {d.rows ? <><GenericTable view={view} rows={d.rows} onAction={setForm} /><Pager d={d} onPage={setPage} /></> : <Plain d={d} />}</>}</Async></Card>
    {form && <GameForm form={form} view={d} onClose={() => setForm(null)} onDone={() => data.reload()} />}</>;
}
const SKIP = new Set(["ownerId", "characterId", "lowId", "highId", "hasImage"]);
function Summary({ d }) {
  const s = d.summary ?? (d.unhoused != null ? { unhoused: d.unhoused } : d.vips != null ? { vips: d.vips, buyouts: d.buyouts } : null);
  return s && typeof s === "object" ? <div className="chips" style={{ marginBottom: 12 }}>{Object.entries(s).map(([k, v]) => typeof v !== "object" && <Badge key={k} plain>{nice(k)}: {cell(k, v)}</Badge>)}</div> : null;
}
function Plain({ d }) {
  return <div className="grid g2">{Object.entries(d).map(([k, v]) => <Card key={k} title={nice(k)}>{Array.isArray(v) ? <Table cards={false} rows={v.map((x) => (typeof x === "object" ? x : { value: x }))} columns={Object.keys(typeof v[0] === "object" ? v[0] : { value: 1 }).map((c) => ({ key: c, label: nice(c), render: (r) => cell(c, r[c]) }))} empty={<Empty title="None" />} /> : v && typeof v === "object" ? <dl className="kv">{Object.entries(v).map(([a, b]) => [<dt key={a + "k"}>{nice(a)}</dt>, <dd key={a}>{cell(a, b)}</dd>])}</dl> : <b className="num">{cell(k, v)}</b>}</Card>)}</div>;
}
function GenericTable({ view, rows, onAction }) {
  if (!rows.length) return <Empty title="Nothing here yet">No records in this list.</Empty>;
  const keys = Object.keys(rows[0]).filter((k) => !SKIP.has(k) && !(k === "id" && rows[0].name != null && view !== "academics.faculties" && !ROW_ACTION[view]));
  const A = ROW_ACTION[view];
  const cols = keys.map((k) => ({ key: k, label: nice(k), render: (r) => cell(k, r[k]), wrap: typeof rows[0][k] === "string" && String(rows[0][k]).length > 40 }));
  if (A) cols.push({ key: "_a", label: "", render: (r) => A.show?.(r) === false ? null : <Btn size="sm" tone={A.tone} onClick={() => onAction({ kind: A.kind, row: r })}>{typeof A.label === "function" ? A.label(r) : A.label}</Btn> });
  return <Table cards={false} rows={rows} columns={cols} rowKey={(r, i) => r.id ?? r.key ?? JSON.stringify(r).slice(0, 80)} />;
}
const ROW_ACTION = {
  businesses: { kind: "business.close", label: "Close", tone: "danger", show: (r) => r.status === "ACTIVE" },
  "academics.faculties": { kind: "faculty.update", label: "Edit" },
  "relationships.bonds": { kind: "bond.end", label: "End bond", tone: "danger", show: (r) => r.endedWeek == null },
  "inventory.items": { kind: "item.remove", label: "Remove", tone: "danger" },
  "inventory.cars": { kind: "car.remove", label: "Remove", tone: "danger" },
  "matches.list": { kind: "match.void", label: "Void match", tone: "danger", show: (r) => r.status === "ACTIVE" },
  "billboards.list": { kind: "billboard.hide", label: (r) => (r.hidden ? "Show again" : "Hide"), tone: "danger" },
};

function GameForm({ form, view, onClose, onDone }) {
  const { kind, row } = form, [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [x, setX] = useState({ difficulty: row?.difficulty ?? "", verified: String(row?.verified ?? false), key: "", quantity: "1", modelId: "", color: "", }), [pl, setPl] = useState(null);
  const T = { "business.close": ["Close business", `${row?.name}: the capital is returned to the owner through the ledger.`], "faculty.update": ["Edit faculty", row?.name], "bond.end": ["End bond", `${row?.lowName} & ${row?.highName}`], "item.remove": ["Remove room item", `${row?.itemName ?? row?.key} owned by ${row?.name}`], "item.grant": ["Give a room item", "Added to the player's room items."],
    "car.remove": ["Remove car", row?.name ?? ""], "car.grant": ["Give a car", "Added to the player's garage."], "match.void": ["Void match", "Cancels the match and returns every wager."], "billboard.hide": [row?.hidden ? "Show billboard again" : "Hide billboard", row?.caption ?? ""] }[kind];
  const body = () => ({ action: kind, reason: reason.trim(),
    ...(kind === "business.close" ? { id: row.id } : kind === "faculty.update" ? { facultyId: row.id, difficulty: x.difficulty, verified: x.verified === "true" } : kind === "bond.end" ? { bondId: row.id } : kind === "item.remove" || kind === "car.remove" ? { id: row.id } :
      kind === "item.grant" ? { key: x.key.trim(), quantity: Number(x.quantity), characterId: pl?.characterId } : kind === "car.grant" ? { modelId: x.modelId, color: x.color || undefined, characterId: pl?.characterId } : kind === "match.void" ? { matchId: row.id } : { id: row.id, hidden: !row.hidden }) });
  const need = (kind === "item.grant" ? x.key.trim() && Number(x.quantity) >= 1 && pl : kind === "car.grant" ? x.modelId && pl : true) && reason.trim().length >= 10;
  async function go(e) { e?.preventDefault(); if (busy || !need) return; setBusy(true); const r = await act("game/action", body(), { pending: "Applying…", success: "Done." }); setBusy(false); if (!r.failed) { onDone(); onClose(); } }
  const cars = view?.catalog;
  return <Modal title={T[0]} sub={T[1]} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn tone={/remove|close|end|void|hide/.test(kind) ? "solid-danger" : "pri"} busy={busy} disabled={!need} onClick={go}>{T[0]}</Btn></>}>
    <form onSubmit={go} style={{ display: "grid", gap: 14 }}>
      {kind === "faculty.update" && <><Input label="Difficulty (0.50 to 2.00)" value={x.difficulty} onChange={(e) => setX({ ...x, difficulty: e.target.value })} /><Select label="Verified" value={x.verified} onChange={(v) => setX({ ...x, verified: v })} options={[["true", "Verified"], ["false", "Not verified"]]} /></>}
      {(kind === "item.grant" || kind === "car.grant") && <PlayerPicker value={pl} onPick={setPl} />}
      {kind === "item.grant" && <><Input label="Item key" value={x.key} onChange={(e) => setX({ ...x, key: e.target.value })} hint="The game's own item id, as shown in the Room items list." /><Input label="Quantity" type="number" min="1" value={x.quantity} onChange={(e) => setX({ ...x, quantity: e.target.value })} /></>}
      {kind === "car.grant" && <>{Array.isArray(cars) && cars.length ? <Select label="Model" value={x.modelId} onChange={(v) => setX({ ...x, modelId: v })} options={[["", "Choose…"], ...cars.map((c) => [String(c.id ?? c.modelId), c.name ?? c.id])]} /> : <Input label="Model id" value={x.modelId} onChange={(e) => setX({ ...x, modelId: e.target.value })} />}<Input label="Colour (optional)" value={x.color} onChange={(e) => setX({ ...x, color: e.target.value })} /></>}
      <Area label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} hint="Audit log. At least 10 characters." data-autofocus /><button hidden />
    </form></Modal>;
}

function Rules() {
  const q = useApi("game/rules"), d = q.data;
  return <Card title="Game rules"><Note>These values are written in the game's code, not in the database, so they cannot be edited from here without a code change. Only faculty difficulty (Academics) and the SUG election calendar are live-tunable.</Note>
    <Async q={q} rows={6}>{d && <div className="stack">{d.sections.map((s) => <details key={s.title} className="card"><summary style={{ cursor: "pointer", fontWeight: 600 }}>{s.title} <span className="mut mono">{s.file}</span></summary>{s.note && <p className="mut">{s.note}</p>}<pre className="mono" style={{ overflow: "auto", maxHeight: 320, margin: "10px 0 0" }}>{JSON.stringify(s.data, null, 2)}</pre></details>)}</div>}</Async></Card>;
}

function Elections() {
  const q = useApi("sug", {}, { every: 30000 }), d = q.data, [busy, setBusy] = useState("");
  async function run(action, body, ask) {
    const reason = ask ? await import("@/lib/confirm").then((c) => c.askText({ title: ask.title, message: ask.message, label: "Reason for the audit log (10+ characters)", multiline: true, confirmLabel: ask.label, tone: "danger" })) : "ok";
    if (reason == null) return; if (ask && reason.length < 10) return import("@/lib/toast").then((t) => t.toast.error("A reason of 10+ characters is required."));
    setBusy(action); const r = await act("sug", { action, ...body, reason }, { pending: "Working…", success: "Done." }); setBusy(""); if (!r.failed) q.reload();
  }
  return <Card title="SUG elections" right={<Btn tone="pri" size="sm" busy={busy === "start"} onClick={async () => { if (await confirmAction({ title: "Start a new election?", message: "Announces a new election cycle with the standard calendar.", confirmLabel: "Start election" })) run("start", {}); }}>Start election</Btn>}>
    <Async q={q} rows={4}>{d && <div className="stack">
      <Table cards={false} rows={d.cycles} rowKey={(r) => r.id} empty={<Empty title="No elections yet" />} columns={[{ key: "n", label: "Cycle", render: (r) => `#${r.number ?? r.id}` }, { key: "s", label: "Status", render: (r) => <Badge tone={r.status === "LIVE" ? "ok" : ""}>{r.status}{r.stage ? ` · ${r.stage}` : ""}</Badge> }, { key: "c", label: "Candidates", n: true, render: (r) => r.candidates }, { key: "b", label: "Ballots", n: true, render: (r) => r.ballots },
        { key: "a", label: "", render: (r) => r.status === "LIVE" ? <Btn size="sm" tone="danger" onClick={() => run("cancel", { id: r.id }, { title: "Cancel this election?", message: "Candidates keep their fee. No results exist yet, so nothing is lost.", label: "Cancel election" })}>Cancel</Btn> : null }]} />
      <Btn busy={busy === "run"} onClick={() => run("run", {})}>Run the count / advance now</Btn>
      {d.standing.length > 0 && <Card title="Candidates standing (disqualify before voting opens)"><Table cards={false} rows={d.standing} rowKey={(r) => r.id} columns={[{ key: "n", label: "Candidate", render: (r) => r.name }, { key: "p", label: "Post", render: (r) => r.title }, { key: "a", label: "", render: (r) => <Btn size="sm" tone="danger" onClick={() => run("disqualify", { candidateId: r.id }, { title: `Disqualify ${r.name}?`, message: "Only possible before voting opens. Recorded in the audit log.", label: "Disqualify" })}>Disqualify</Btn> }]} /></Card>}
      <p className="mut">Administrators can run the calendar and disqualify candidates. They cannot change a ballot, a vote total, a result or an appointment.</p>
    </div>}</Async></Card>;
}
