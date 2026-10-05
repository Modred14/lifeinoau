// app/admin/page.js
"use client";
import { useCallback, useEffect, useState } from "react";
import { call, naira } from "@/lib/client";

export default function Admin() {
  const [tab, setTab] = useState("overview"), [ov, setOv] = useState(null), [reports, setReports] = useState([]), [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState(null), [busy, setBusy] = useState(false), [ctx, setCtx] = useState({}), [name, setName] = useState(""), [p, setP] = useState(null);
  const [adj, setAdj] = useState({ direction: "credit", amountNaira: "", reason: "" });
  const guard = (r) => { if (r.status === 404 && r.error === "Not found.") { setDenied(true); return true; } if (r.failed) { setMsg({ bad: true, text: r.error }); return true; } return false; };

  const load = useCallback(async () => {
    const [o, r] = await Promise.all([call("/api/admin/overview"), call("/api/admin/reports")]);
    if (!guard(o)) setOv(o); if (!guard(r)) setReports(r.reports);
  }, []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  async function resolve(id, action) {
    const note = prompt("Short note for the audit log (required):"); if (!note) return;
    setBusy(true); const r = await call("/api/admin/reports", { id, action, note }); setBusy(false);
    guard(r) || (setMsg({ text: "Report handled." }), load());
  }
  async function showMsgs(id) { const r = await call("/api/admin/report-messages?id=" + id); if (!guard(r)) setCtx((c) => ({ ...c, [id]: r.messages })); }
  async function find(e) { e.preventDefault(); setMsg(null); const r = await call("/api/admin/player?name=" + encodeURIComponent(name)); guard(r) || setP(r); }
  async function adjust(e) {
    e.preventDefault(); if (!confirm(`${adj.direction} ₦${Number(adj.amountNaira).toLocaleString()} for ${p.name}? This is permanent and audited.`)) return;
    setBusy(true); const r = await call("/api/admin/adjust", { ...adj, name: p.name, amountNaira: Number(adj.amountNaira), requestId: crypto.randomUUID() }); setBusy(false);
    if (!guard(r)) { setMsg({ text: "Adjustment recorded." }); setAdj({ direction: "credit", amountNaira: "", reason: "" }); find(e); }
  }
  if (denied) return <p>Not found.</p>;
  return (<>
    <div className="top"><h2>Admin</h2><a href="/play"><button>Back</button></a></div>
    <div className="row" role="tablist">{[["overview", "Overview"], ["reports", `Reports${ov?.openReports ? " (" + ov.openReports + ")" : ""}`], ["player", "Player"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
    {msg && <div className={"msg " + (msg.bad ? "bad" : "ok")} role="status">{msg.text}</div>}
    {tab === "overview" && ov && <>
      <div className="card"><b>{ov.integrity.ok ? "✅ Ledger integrity: every player balance matches the ledger" : "🚨 Ledger mismatch found"}</b>
        {!ov.integrity.businessOk && <p className="bad">The BUSINESS pool does not match the capital held in businesses ({naira(ov.integrity.businessCapitalKobo)}).</p>}
        {ov.integrity.mismatches.map((m) => <p key={m.id} className="bad">Account {m.id}: cached {naira(m.cached)}, ledger {naira(m.ledger)}</p>)}</div>
      <div className="card stats"><div><b>{ov.players}</b><br /><span className="mut">players</span></div><div><b>{ov.jailed}</b><br /><span className="mut">in Floor 0</span></div><div><b>{ov.expelled}</b><br /><span className="mut">expelled</span></div><div><b>{ov.ledgerRows}</b><br /><span className="mut">ledger rows</span></div></div>
      <div className="card"><b>Economy</b><p>Player cash in circulation: <b>{naira(ov.playerCashKobo)}</b></p><p className="mut">Classes: {Object.entries(ov.byClass).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}</p>
        {ov.systemBalancesKobo.map((s) => <div className="led" key={s.name}><span>{s.name}</span><b>{naira(s.balance)}</b></div>)}
        <p className="mut">WORLD is negative by the total money created. Other accounts show what has been drained out of the economy.</p></div></>}
    {tab === "reports" && <div className="card">{reports.length ? reports.map((r) => <div key={r.id} className="led" style={{ display: "block" }}>
      <p><b>{r.reporter}</b> reported <b>{r.target}</b><br /><span className="mut">{r.reason}</span></p>
      {ctx[r.id] && <div className="card">{ctx[r.id].map((m, i) => <p key={i} className={m.fromReporter ? "ok" : "bad"}>{m.body}</p>)}{!ctx[r.id].length && <p className="mut">No messages.</p>}</div>}
      <div className="row"><button disabled={busy} onClick={() => showMsgs(r.id)}>Read chat (logged)</button><button disabled={busy} onClick={() => resolve(r.id, "dismiss")}>Dismiss</button><button disabled={busy} onClick={() => resolve(r.id, "actioned")}>Warned</button><button disabled={busy} onClick={() => resolve(r.id, "suspend")}>Suspend 2 weeks</button></div></div>) : <p className="mut">No open reports.</p>}</div>}
    {tab === "player" && <><form className="card" onSubmit={find}><label>Player name<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label><button className="go" disabled={!name}>Look up (logged)</button></form>
      {p && <><div className="card"><h2>{p.name}</h2><p className="mut">{p.faculty} · {p.level}L · {p.class} · strikes {p.strikes}{p.expelled && " · EXPELLED"}</p><p>Balance <b>{naira(p.balanceKobo)}</b></p>
        {p.ledger.map((e, i) => <div className="led" key={i}><span>{e.memo}<br /><span className="mut">week {e.week}</span></span><b className={e.dir === "in" ? "ok" : "bad"}>{e.dir === "in" ? "+" : "-"}{naira(e.amountKobo)}</b></div>)}</div>
        <form className="card" onSubmit={adjust}><b>Adjust money (audited)</b><div className="row"><select value={adj.direction} onChange={(e) => setAdj({ ...adj, direction: e.target.value })}><option value="credit">Credit</option><option value="debit">Debit</option></select>
          <input type="text" inputMode="numeric" placeholder="₦ amount (max 1,000,000)" value={adj.amountNaira} onChange={(e) => setAdj({ ...adj, amountNaira: e.target.value.replace(/\D/g, "") })} /></div>
          <input type="text" placeholder="Reason (required, 10+ characters)" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} style={{ marginTop: 8 }} />
          <button className="go" style={{ marginTop: 8 }} disabled={busy || !adj.amountNaira || adj.reason.length < 10}>Apply</button></form></>}</>}
  </>);
}
