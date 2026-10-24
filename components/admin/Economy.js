// components/admin/Economy.js — money: exact balance changes, group rewards, the transaction ledger, suspicious activity and distribution.
"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { opId, opDone, useApi, useDebounced, useQueryState, PageHead, Card, Async, Table, Pager, Search, Select, Input, Tabs, Seg, Stat, Note, Badge, Btn, Empty, PlayerPicker, Person, Area, kobo, koboShort, ago, when, int, act } from "./kit";
import { HBars } from "./charts";
import { MoneyForm, parseNaira } from "./Actions";

export default function Economy() {
  const [tab, setTab] = useState("stats");
  return (<><PageHead title="Economy" sub="Balances are exact to the kobo. Every change is a ledger entry with an audit record: who, whom, how much, why, before and after." />
    <Tabs value={tab} onChange={setTab} options={[["stats", "Overview"], ["adjust", "Change a balance"], ["bulk", "Group reward"], ["tx", "Transactions"], ["sus", "Suspicious"]]} />
    {tab === "stats" && <Stats />}{tab === "adjust" && <Adjust />}{tab === "bulk" && <Bulk />}{tab === "tx" && <Tx />}{tab === "sus" && <Suspicious />}</>);
}

function Stats() {
  const q = useApi("economy/stats", {}, { every: 60000 }), d = q.data, router = useRouter();
  return <Async q={q} rows={8}>{d && <div className="stack">
    <div className="grid g4"><Stat label="Money in player accounts" value={koboShort(d.totalKobo)} title={kobo(d.totalKobo)} sub={kobo(d.totalKobo)} /><Stat label="Median balance" value={koboShort(d.medianKobo)} sub={kobo(d.medianKobo)} /><Stat label="Mean balance" value={koboShort(d.meanKobo)} sub="skewed by the richest" /><Stat label="Richest player" value={koboShort(d.maxKobo)} sub={kobo(d.maxKobo)} /></div>
    <div className="grid g2">
      <Card title="Distribution of balances"><HBars rows={d.distribution.map((b) => ({ label: b.label, value: b.players, text: int(b.players), title: `${b.players} players hold ${kobo(b.sumKobo)}` }))} /></Card>
      <Card title="System accounts"><dl className="kv">{d.system.map((s) => <Fragment key={s.name}><dt>{s.name}</dt><dd className="num" title={kobo(s.balance)}>{koboShort(s.balance)} <span className="mut">{kobo(s.balance)}</span></dd></Fragment>)}<dt>Archived accounts</dt><dd className="num">{kobo(d.archivedKobo)}</dd></dl></Card>
    </div>
    <Card title="Largest balances">
      <Table cards={false} rows={d.wealthy} rowKey={(r) => r.characterId} onRow={(r) => router.push(`/admin/players/${r.characterId}`)} columns={[{ key: "n", label: "Player", render: (r) => <Person name={r.name} /> }, { key: "b", label: "Balance", n: true, render: (r) => <span title={kobo(r.balance)}>{koboShort(r.balance)}</span> }, { key: "m", label: "Times the median", n: true, render: (r) => r.timesMedian >= 1000 ? r.timesMedian.toExponential(1) : r.timesMedian.toFixed(1) }, { key: "u", label: "", render: (r) => r.unusual ? <Badge tone="warn">Unusual</Badge> : r.status !== "ACTIVE" ? <Badge plain>{r.status}</Badge> : null }]} />
      <p className="mut" style={{ marginTop: 10 }}>{d.definitions.unusual}</p>
    </Card>
    <Card title="Biggest balance changes recently">{d.movers.length ? <Table cards={false} rows={d.movers} columns={[{ key: "n", label: "Player", render: (r) => r.name }, { key: "d", label: "Net change (24h)", n: true, render: (r) => <span className={String(r.net).startsWith("-") ? "bad" : "ok"} title={kobo(r.net, { sign: true })}>{koboShort(r.net)}</span> }, { key: "e", label: "Entries", n: true, render: (r) => r.entries }]} /> : <Empty title="No big movements">{d.definitions.movers}</Empty>}</Card>
  </div>}</Async>;
}

function Adjust() {
  const [pl, setPl] = useState(null), [done, setDone] = useState(0), [open, setOpen] = useState(false), look = useApi("player", { ref: pl?.characterId }, { skip: !pl, every: 0 });
  return <div className="grid g-main"><div className="stack"><Card title="1. Choose the player">
    <PlayerPicker value={pl} onPick={(p) => { setPl(p); setOpen(false); }} />
    {pl && look.data && <><dl className="kv" style={{ marginTop: 12 }}><dt>Current balance</dt><dd className="num"><b>{kobo(look.data.balance)}</b></dd><dt>Account</dt><dd>{look.data.account.status}</dd></dl>
      {look.data.account.status === "DELETED" ? <Note tone="warn">This account is archived. Restore it before changing its balance.</Note> : <div className="adm-actions" style={{ marginTop: 12 }}><Btn tone="pri" onClick={() => setOpen("credit")}>Give money</Btn><Btn tone="danger" onClick={() => setOpen("debit")}>Deduct money</Btn><Btn onClick={() => setOpen("set")}>Set exact balance</Btn></div>}</>}
    {pl && look.loading && !look.data && <p className="mut">Loading…</p>}
  </Card></div>
    <Card title="Rules"><ul className="mut" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}><li>No limit on how much you can give. The only ceiling is the database's own: ₦92,233,720,368,547,758.07.</li><li>Amounts are typed exactly. Nothing is rounded.</li><li>A deduction can never take a balance below zero.</li><li>A reason is required and stored with the previous and new balance.</li><li>Pressing twice, or retrying after a bad connection, applies the change once.</li></ul></Card>
    {open && look.data && <MoneyForm initialMode={open} p={{ characterId: pl.characterId, name: pl.name, balance: look.data.balance }} onClose={() => setOpen(false)} onDone={() => look.reload()} />}</div>;
}

const AUD = [["all", "Every player"], ["online", "Players online now"], ["class", "A class"], ["faculty", "A faculty"], ["level", "A level"], ["names", "Named players"]];
export function AudiencePicker({ aud, setAud }) {
  const fac = useApi("game/list", { view: "academics.faculties" }, { skip: aud.type !== "faculty" });
  return <div className="row">
    <Select label="Who" value={aud.type} onChange={(type) => setAud({ type })} options={AUD} />
    {aud.type === "class" && <Select label="Class" value={aud.class ?? ""} onChange={(v) => setAud({ ...aud, class: v })} options={[["", "Choose…"], "NEPO", "MAPO", "LAPO"]} />}
    {aud.type === "level" && <Select label="Level" value={String(aud.level ?? "")} onChange={(v) => setAud({ ...aud, level: Number(v) })} options={[["", "Choose…"], ...[100, 200, 300, 400, 500].map((l) => [String(l), `${l}L`])]} />}
    {aud.type === "faculty" && <Select label="Faculty" value={String(aud.facultyId ?? "")} onChange={(v) => setAud({ ...aud, facultyId: Number(v) })} options={[["", "Choose…"], ...(fac.data?.rows ?? []).map((f) => [String(f.id ?? f.facultyId), f.name ?? f.faculty])]} />}
    {aud.type === "names" && <div style={{ flex: "1 1 100%" }}><Area label="Usernames" value={aud.names ?? ""} onChange={(e) => setAud({ ...aud, names: e.target.value })} hint="One per line or separated by commas." /></div>}
  </div>;
}

function Bulk() {
  const [aud, setAud] = useState({ type: "class", class: "" }), [amt, setAmt] = useState(""), [reason, setReason] = useState(""), [msg, setMsg] = useState(""), [pv, setPv] = useState(null), [busy, setBusy] = useState(false), [typed, setTyped] = useState(""), [result, setResult] = useState(null);
  const a = parseNaira(amt);
  async function preview() { setBusy(true); const r = await import("./kit").then((k) => k.post("economy/bulk-preview", { audience: aud, amount: amt })); setBusy(false); if (r.failed) return setPv({ error: r.error }); setPv(r); setTyped(""); setResult(null); }
  async function send() {
    setBusy(true); let offset = 0, r, total = { granted: 0, repeated: 0, failed: 0 };
    const content = { aud, amt: String(amt).trim(), reason: reason.trim(), msg: msg.trim(), count: pv.count }, requestId = opId(content); // one id for the whole run: resuming never repeats a payment
    do {
      r = await act("economy/bulk-grant", { audience: aud, amount: String(amt).trim(), reason: reason.trim(), message: msg.trim() || undefined, confirm: typed.trim(), expectedCount: pv.count, offset, requestId }, { pending: "Paying recipients…", success: r?.done === false ? "Paying…" : "Group reward paid." });
      if (r.failed) break; total = { granted: total.granted + (r.granted ?? 0), repeated: total.repeated + (r.repeated ?? 0), failed: total.failed + (Array.isArray(r.failed) ? r.failed.length : Number(r.failed) || 0) }; offset = r.nextOffset ?? 0;
    } while (r.nextOffset != null && !r.done);
    setBusy(false); if (!r.failed) { opDone(content); setResult(total); setPv(null); }
  }
  return <div className="grid g-main"><Card title="Pay a group"><div className="stack">
    <AudiencePicker aud={aud} setAud={(x) => { setAud(x); setPv(null); }} />
    <Input label="Amount for each player (₦)" inputMode="decimal" value={amt} onChange={(e) => { setAmt(e.target.value); setPv(null); }} error={a.error} hint="Same amount to everyone in the group. No upper limit." />
    <Input label="Message to recipients (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} />
    <Area label="Reason (audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} hint="At least 10 characters." />
    <div><Btn tone="pri" busy={busy && !pv} disabled={a.kobo == null || reason.trim().length < 10} onClick={preview}>Preview recipients</Btn></div>
    {pv?.error && <Note tone="bad">{pv.error}</Note>}
    {pv && !pv.error && <div className="preview"><span className="mut">{pv.label}</span><span className="big num">{int(pv.count)} players × {kobo(pv.eachKobo)} = {kobo(pv.totalKobo)}</span>
      {pv.missing?.length > 0 && <Note tone="warn">Not found: {pv.missing.join(", ")}</Note>}{pv.sample?.length > 0 && <span className="mut">e.g. {pv.sample.slice(0, 5).join(", ")}</span>}
      {pv.count === 0 ? <Note tone="warn">Nobody matches. Nothing to pay.</Note> : <>{pv.confirmText && <Input label={`Type ${pv.confirmText} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
        <Btn tone="solid-danger" busy={busy} disabled={pv.confirmText && typed.trim() !== pv.confirmText} onClick={send}>Pay {int(pv.count)} players {kobo(pv.totalKobo)}</Btn></>}</div>}
    {result && <Note><b>Done.</b> {int(result.granted)} players paid{result.repeated ? `, ${int(result.repeated)} had already been paid` : ""}{result.failed ? `, ${result.failed} failed (see the audit log)` : ""}.</Note>}
  </div></Card><Card title="Safety"><ul className="mut" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}><li>Only accounts in good standing are paid. Suspended and archived accounts are skipped.</li><li>Each recipient gets their own ledger entry and audit record.</li><li>If the connection drops, press Pay again: players already paid are not paid twice.</li><li>You must type a confirmation when more than a few people are paid.</li></ul></Card></div>;
}

function Tx() {
  const [f, set] = useQueryState({ q: "", player: "", kind: "", min: "", max: "", from: "", to: "", sort: "id", dir: "desc", page: 1 }), q = useDebounced(f.q), data = useApi("economy/transactions", { ...f, q }), d = data.data;
  return <><div className="row" style={{ marginBottom: 14 }}>
    <Search value={f.q} onChange={(v) => set({ q: v })} placeholder="Search memo text…" />
    <Input label="Player" value={f.player} onChange={(e) => set({ player: e.target.value })} placeholder="username" />
    <Select label="Kind" value={f.kind} onChange={(v) => set({ kind: v })} options={[["", "All"], ["admin", "Admin changes only"], ["player", "Between players"]]} />
    <Input label="Min (₦)" inputMode="decimal" value={f.min} onChange={(e) => set({ min: e.target.value })} /><Input label="Max (₦)" inputMode="decimal" value={f.max} onChange={(e) => set({ max: e.target.value })} />
    <Input label="From" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /><Input label="To" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></div>
    <Async q={data} rows={8}>{d && <><Table rows={d.rows} rowKey={(r) => r.id} loading={data.loading} sort={f.sort} dir={f.dir} onSort={(sort, dir) => set({ sort, dir })} columns={[
      { key: "at", label: "Time", sort: "id", render: (r) => <span title={when(r.at)}>{ago(r.at)}</span> }, { key: "from", label: "From", render: (r) => r.from }, { key: "to", label: "To", render: (r) => r.to },
      { key: "amt", label: "Amount", n: true, sort: "amount", render: (r) => <span title={kobo(r.amountKobo)}>{koboShort(r.amountKobo)}</span> }, { key: "memo", label: "Memo", wrap: true, render: (r) => <span>{r.admin && <Badge tone="info" plain>Admin</Badge>} {r.memo}</span> }, { key: "wk", label: "Week", n: true, render: (r) => r.week }]} />
      <Pager d={d} onPage={(page) => set({ page })} noun="transactions" /></>}</Async></>;
}

function Suspicious() {
  const [days, setDays] = useState("7"), q = useApi("economy/suspicious", { days }), d = q.data, router = useRouter();
  return <><div className="toolbar"><Seg value={days} onChange={setDays} label="Window" options={[["1", "24 hours"], ["7", "7 days"], ["30", "30 days"]]} /></div>
    <Async q={q} rows={6}>{d && <div className="stack">
      <Note><b>How entries are flagged.</b> <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{d.rules.map((r) => <li key={r}>{r}</li>)}</ul>Median balance now {kobo(d.medianKobo)}; the "large" threshold is {kobo(d.thresholdKobo)}.</Note>
      <Card title={`Flagged transactions (${d.entries.length})`}>{d.entries.length ? <Table cards={false} rows={d.entries} rowKey={(r) => r.id} columns={[{ key: "at", label: "Time", render: (r) => ago(r.at) }, { key: "p", label: "From → to", render: (r) => <span>{r.from} → {r.toId ? <a href={`/admin/players/${r.toId}`}>{r.to}</a> : r.to}</span> }, { key: "a", label: "Amount", n: true, render: (r) => <span title={kobo(r.amountKobo)}>{koboShort(r.amountKobo)}</span> }, { key: "r", label: "Why flagged", wrap: true, render: (r) => <span className="chips">{r.reasons.map((x) => <Badge key={x} tone="warn" plain>{x}</Badge>)}</span> }]} /> : <Empty title="Nothing unusual">No transaction in this window matches the rules above.</Empty>}</Card>
      <Card title="Bursts">{d.bursts.length ? <Table cards={false} rows={d.bursts} columns={[{ key: "n", label: "Player", render: (r) => <a href={`/admin/players/${r.characterId}`}>{r.name}</a> }, { key: "c", label: "Entries in the hour", n: true, render: (r) => r.entries }, { key: "v", label: "Volume", n: true, render: (r) => <span title={kobo(r.volume)}>{koboShort(r.volume)}</span> }, { key: "w", label: "Hour", render: (r) => when(r.hour) }]} /> : <Empty title="No bursts" />}</Card>
    </div>}</Async></>;
}
