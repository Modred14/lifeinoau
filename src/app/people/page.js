// src/app/people/page.js
"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";

export default function People() {
  const router = useRouter();
  const [q, setQ] = useState(""), [found, setFound] = useState([]), [inbox, setInbox] = useState([]);
  const [who, setWho] = useState(null), [prof, setProf] = useState(null), [thread, setThread] = useState([]);
  const [text, setText] = useState(""), [amt, setAmt] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  const fail = (r) => (r.status === 401 ? loggedOut(router) : notifyError(r, "Something went wrong. Please try again."));

  const loadInbox = useCallback(async () => { const r = await call("/api/messages"); r.failed ? fail(r) : setInbox(r.conversations); }, []); // eslint-disable-line
  useEffect(() => { loadInbox(); }, [loadInbox]);
  useEffect(() => { if (q.trim().length < 2) return setFound([]); const t = setTimeout(async () => { const r = await call("/api/players?q=" + encodeURIComponent(q)); if (r.failed) fail(r); else setFound(r.players); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(name) {
    setWho(name); setProf(null);
    const [p, m] = await Promise.all([call("/api/profile?name=" + encodeURIComponent(name)), call("/api/messages?with=" + encodeURIComponent(name))]);
    p.failed ? fail(p) : setProf(p); m.failed ? fail(m) : setThread(m.messages); loadInbox();
  }
  async function act(path, body, ok, after) { if (busy) return; setBusy(true); const r = await call(path, body); setBusy(false); if (r.failed) return fail(r); if (r.duplicate) toast.info("Already done."); else toast.success(ok(r)); after?.(); }
  const send = (e) => { e.preventDefault(); act("/api/messages", { to: who, body: text }, () => "Sent.", () => { setText(""); open(who); }); };
  const pay = (e) => { e.preventDefault(); act("/api/transfer", { to: who, amountNaira: Number(amt), memo: note, requestId: crypto.randomUUID() }, (r) => `Sent ${naira(r.sentKobo)} (fee ${naira(r.feeKobo)}).`, () => { setAmt(""); setNote(""); }); };
  const fee = Number.isInteger(Number(amt)) && Number(amt) > 0 ? Math.floor(Number(amt) * 0.02) : 0;

  return (<>
    <div className="top"><h2>People</h2><a href="/play"><button>Back to game</button></a></div>
    <div className="card"><label>Find a player<input type="text" placeholder="Start typing a name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="row" style={{ marginTop: 8 }}>{found.map((p) => <button key={p.name} onClick={() => open(p.name)}>{p.name}<br /><span className="mut">{p.level}L · {p.faculty}</span></button>)}</div></div>
    {!who && <div className="card"><b>Messages</b>{inbox.length ? inbox.map((c) => <button key={c.name} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8 }} onClick={() => open(c.name)}>
      <b>{c.name}</b> {c.unread > 0 && <span className="ok">({c.unread} new)</span>}<br /><span className="mut">{c.last.slice(0, 60)}</span></button>) : <p className="mut">No conversations yet. Search for a player to say hi.</p>}</div>}
    {who && prof && <>
      <div className="card"><div className="top"><h2>{prof.name}</h2><button onClick={() => { setWho(null); setProf(null); }}>Close</button></div>
        <p className="mut">{prof.faculty} · {prof.level}L · {prof.class} · {prof.personalities.join(", ")}</p>
        <p>CGPA {prof.cgpa ?? "–"} · Net worth {naira(prof.netWorthKobo)} · Popularity {prof.popularity}{prof.graduated && ` · 🎓 ${prof.classification}`}</p>
        {prof.achievements?.length > 0 && <p>{prof.achievements.map((a) => <span key={a} className="msg" style={{ display: "inline-block", margin: "2px 4px 2px 0", padding: "2px 8px" }}>🏆 {a}</span>)}</p>}</div>
      <div className="card"><b>Chat</b><div style={{ maxHeight: 260, overflow: "auto", margin: "8px 0" }}>{thread.length ? thread.map((m, i) => <p key={i} style={{ textAlign: m.mine ? "right" : "left" }}><span className={m.mine ? "ok" : ""}>{m.body}</span></p>) : <p className="mut">No messages yet.</p>}</div>
        <form onSubmit={send} className="row"><input type="text" maxLength={500} placeholder="Write a message" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: "3 1 200px" }} /><button className="go" disabled={busy || !text.trim()}>Send</button></form></div>
      <form className="card" onSubmit={pay}><b>Send money</b><p className="mut">₦100 to ₦5,000,000 each, ₦10M a day. A 2% fee is added on top.</p>
        <div className="row"><input type="text" inputMode="numeric" placeholder="Amount in naira" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ""))} /><input type="text" maxLength={80} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {Number(amt) > 0 && <p className="mut">You pay ₦{(Number(amt) + fee).toLocaleString("en-NG")} in total.</p>}
        <button className="go" disabled={busy || Number(amt) < 100}>Send {amt ? "₦" + Number(amt).toLocaleString("en-NG") : "money"}</button></form>
      <div className="card"><div className="row"><button disabled={busy} onClick={() => act("/api/safety", { action: "block", name: who }, () => "Blocked. You can no longer message or pay each other.")}>Block {prof.name}</button>
        <button disabled={busy} onClick={() => { const reason = prompt("What happened?"); if (reason === null) return; if (!reason.trim()) return void toast.error("Add a short description so we can review the report."); act("/api/safety", { action: "report", name: who, reason }, () => "Report sent. Thank you."); }}>Report</button></div></div></>}
  </>);
}