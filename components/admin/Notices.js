// components/admin/Notices.js — announcements and targeted notices. Delivered as the game's own notifications; sent in safe chunks that can be resumed.
"use client";
import { useState } from "react";
import { useApi, PageHead, Card, Async, Table, Pager, Seg, Input, Area, Note, Btn, Empty, Badge, kobo, ago, when, int, post, act, opId, opDone } from "./kit";
import { AudiencePicker } from "./Economy";

export default function Notices() {
  const [aud, setAud] = useState({ type: "all" }), [kind, setKind] = useState("ANNOUNCEMENT"), [msg, setMsg] = useState(""), [pv, setPv] = useState(null), [busy, setBusy] = useState(false), [typed, setTyped] = useState(""), [page, setPage] = useState(1), hist = useApi("notify/history", { page });
  async function preview() { setBusy(true); const r = await post("notify/preview", { audience: aud }); setBusy(false); setPv(r.failed ? { error: r.error } : r); setTyped(""); }
  async function send() {
    setBusy(true); const content = { aud, kind, msg: msg.trim(), count: pv.count }, requestId = opId(content); let offset = 0, r;
    do { r = await act("notify/send", { audience: aud, message: msg.trim(), kind, requestId, confirm: typed.trim(), expectedCount: pv.count, offset }, { pending: "Sending…", success: "Sent." }); if (r.failed) break; offset = r.nextOffset ?? 0; } while (r.nextOffset != null && !r.done);
    setBusy(false); if (!r.failed) { opDone(content); setMsg(""); setPv(null); hist.reload(); }
  }
  const ready = msg.trim().length >= 3;
  return (<><PageHead title="Announcements & notices" sub="Messages players receive in their notifications: to everyone, a group, or named players." />
    <div className="grid g-main"><Card title="Compose"><div className="stack">
      <Seg value={kind} onChange={setKind} label="Type" options={[["ANNOUNCEMENT", "Announcement"], ["ADMIN", "Notice from an administrator"]]} />
      <AudiencePicker aud={aud} setAud={(x) => { setAud(x); setPv(null); }} />
      <Area label="Message" value={msg} onChange={(e) => { setMsg(e.target.value); }} maxLength={300} hint={`${msg.length}/300 · Written for players to read.`} />
      <div><Btn tone="pri" busy={busy && !pv} disabled={!ready} onClick={preview}>Preview recipients</Btn></div>
      {pv?.error && <Note tone="bad">{pv.error}</Note>}
      {pv && !pv.error && <div className="preview"><span className="mut">{pv.label}</span><span className="big num">{int(pv.count)} recipient{pv.count === 1 ? "" : "s"}</span>{pv.missing?.length > 0 && <Note tone="warn">No player found for: {pv.missing.join(", ")}</Note>}{pv.sample?.length > 0 && <span className="mut">e.g. {pv.sample.slice(0, 6).join(", ")}</span>}
        {pv.count === 0 ? <Note tone="warn">Nobody matches.</Note> : <>{pv.confirmText && <Input label={`Type ${pv.confirmText} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}<Btn tone="pri" busy={busy} disabled={pv.confirmText && typed.trim() !== pv.confirmText} onClick={send}>Send to {int(pv.count)}</Btn></>}</div>}
    </div></Card>
      <Card title="Good to know"><ul className="mut" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}><li>Only accounts in good standing receive notices.</li><li>A repeat of the same send never delivers twice.</li><li>Sending is recorded in the audit log.</li></ul></Card></div>
    <h2 style={{ margin: "26px 0 12px" }}>Sent</h2>
    <Async q={hist} rows={4}>{hist.data && <><Table rows={hist.data.rows} rowKey={(r) => r.id} empty={<Empty title="Nothing sent yet" />} columns={[{ key: "at", label: "When", render: (r) => <span title={when(r.at)}>{ago(r.at)}</span> }, { key: "k", label: "Type", render: (r) => <Badge plain>{r.kind === "ADMIN" ? "Notice" : "Announcement"}</Badge> }, { key: "a", label: "Audience", render: (r) => `${r.audience} (${int(r.recipients)})` }, { key: "m", label: "Message", wrap: true, render: (r) => r.message }, { key: "by", label: "By", render: (r) => r.actor }]} /><Pager d={hist.data} onPage={setPage} noun="sends" /></>}</Async></>);
}
