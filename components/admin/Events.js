// components/admin/Events.js — add, change and remove the events shown in the Parties app.
// The flyer is shrunk in the browser before it is sent, so any normal photo or poster fits the size limit.
"use client";
import { useRef, useState } from "react";
import { useApi, PageHead, Card, Async, Table, Input, Note, Btn, Empty, Badge, kobo, when, act } from "./kit";
import { confirmAction } from "@/lib/confirm";

const EMPTY = { name: "", host: "", price: "", date: "", ticketUrl: "" };
const MAX_SIDE = 1000, MAX_BYTES = 550_000;

/** <input type="datetime-local"> wants the local time as "YYYY-MM-DDTHH:mm". */
const toLocalInput = (iso) => { const d = new Date(iso), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** A picture file -> JPEG data URL no bigger than MAX_SIDE pixels and MAX_BYTES, or throws a message for the administrator. */
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP picture.");
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("That picture could not be read."); });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  for (let q = 0.88; q >= 0.4; q -= 0.12) {
    const url = c.toDataURL("image/jpeg", q);
    if (Math.ceil((url.length - 23) * 0.75) <= MAX_BYTES) return url;
  }
  throw new Error("That picture is too detailed to shrink enough. Try a smaller one.");
}

export default function Events() {
  const list = useApi("events"), [f, setF] = useState(EMPTY), [flyer, setFlyer] = useState(null), [editing, setEditing] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(""), fileRef = useRef(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const reset = () => { setF(EMPTY); setFlyer(null); setEditing(null); setErr(""); if (fileRef.current) fileRef.current.value = ""; };

  async function pick(e) {
    const file = e.target.files?.[0]; if (!file) return; setErr("");
    try { setFlyer(await shrink(file)); } catch (x) { setFlyer(null); setErr(x.message); e.target.value = ""; }
  }
  function edit(r) { setEditing(r); setFlyer(null); setErr(""); setF({ name: r.name, host: r.host, price: (BigInt(r.priceKobo) / 100n).toString() + (BigInt(r.priceKobo) % 100n ? "." + String(BigInt(r.priceKobo) % 100n).padStart(2, "0") : ""), date: toLocalInput(r.date), ticketUrl: r.ticketUrl }); window.scrollTo?.({ top: 0, behavior: "smooth" }); }

  async function save(e) {
    e.preventDefault(); setErr("");
    if (!editing && !flyer) return setErr("Add the event flyer.");
    if (!f.date) return setErr("Pick the date and time.");
    setBusy(true);
    const body = { ...f, price: f.price.trim() || "0", date: new Date(f.date).toISOString(), ...(flyer ? { flyer } : {}), ...(editing ? { id: editing.id } : {}) };
    const r = await act(editing ? "events/update" : "events/create", body, { pending: editing ? "Saving…" : "Adding the event…", success: editing ? "Event saved." : "Event added. It is now in the Parties app." });
    setBusy(false);
    if (r.failed) return setErr(r.error || "That did not go through.");
    reset(); list.reload();
  }
  async function remove(r) {
    if (!(await confirmAction({ title: `Remove "${r.name}"?`, message: "It disappears from the Parties app straight away. This cannot be undone.", confirmLabel: "Remove event", tone: "danger" }))) return;
    const x = await act("events/delete", { id: r.id }, { pending: "Removing…", success: "Event removed." });
    if (!x.failed) { if (editing?.id === r.id) reset(); list.reload(); }
  }

  const now = list.data ? +new Date(list.data.now) : Date.now();
  return (<><PageHead title="Events" sub="The parties players see in the Parties app. Add as many as you like, including several in one week." />
    <Card title={editing ? `Edit “${editing.name}”` : "Add an event"} right={editing && <Btn size="sm" onClick={reset}>Cancel edit</Btn>}>
      <form className="stack" onSubmit={save}>
        <div className="field"><label htmlFor="ev-flyer">Event flyer</label>
          <input id="ev-flyer" ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} />
          <span className="hint">{editing ? "Leave empty to keep the current flyer. " : ""}JPG, PNG or WebP. It is resized automatically.</span>
          {(flyer || editing) && /* eslint-disable-next-line @next/next/no-img-element */ <img src={flyer ?? editing.flyer} alt="Flyer preview" style={{ maxWidth: 180, maxHeight: 225, borderRadius: 10, marginTop: 8, objectFit: "cover" }} />}
        </div>
        <div className="grid g2">
          <Input label="Event name" value={f.name} onChange={set("name")} maxLength={80} required />
          <Input label="Host" value={f.host} onChange={set("host")} maxLength={80} required />
          <Input label="Price (₦)" value={f.price} onChange={set("price")} inputMode="decimal" placeholder="0 for free" hint="Naira, for example 5000 or 2500.50." />
          <Input label="Date and time" type="datetime-local" value={f.date} onChange={set("date")} required />
        </div>
        <Input label="Ticket link" type="url" value={f.ticketUrl} onChange={set("ticketUrl")} maxLength={500} placeholder="https://…" hint="The Buy ticket button opens this page in a new tab." required />
        {err && <Note tone="bad">{err}</Note>}
        <div><Btn tone="pri" type="submit" busy={busy}>{editing ? "Save changes" : "Add event"}</Btn></div>
      </form>
    </Card>
    <h2 style={{ margin: "26px 0 12px" }}>All events</h2>
    <Async q={list} rows={4}>{list.data && <Table rows={list.data.rows} rowKey={(r) => r.id} empty={<Empty title="No events yet">Add the first one above.</Empty>} columns={[
      { key: "flyer", label: "Flyer", render: (r) => /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.flyer} alt="" width={40} height={50} style={{ borderRadius: 6, objectFit: "cover" }} /> },
      { key: "name", label: "Event", wrap: true, render: (r) => <><b>{r.name}</b> {+new Date(r.date) < now - 12 * 3_600_000 && <Badge plain>Past</Badge>}</> },
      { key: "host", label: "Host", wrap: true, render: (r) => r.host },
      { key: "price", label: "Price", render: (r) => (BigInt(r.priceKobo) === 0n ? "Free" : kobo(r.priceKobo)) },
      { key: "date", label: "Date", render: (r) => when(r.date) },
      { key: "go", label: "", render: (r) => <span className="adm-actions"><Btn size="sm" onClick={() => edit(r)}>Edit</Btn><Btn size="sm" tone="danger" onClick={() => remove(r)}>Remove</Btn></span> },
    ]} />}</Async></>);
}
