// components/BillboardPanel.js
// The buy flow shown in the map's place card when a billboard is selected: pick spots (or the whole board), add a poster, reserve, pay.
// Prices are REAL naira. The Pay button is a test payment until the real provider is wired (the API says whether test payments are on).
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { call, loggedOut, notifyError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { BILLBOARD } from "@/lib3d/mapExtras.js";
import "./billboard-panel.css";

const N = (kobo) => "₦" + (kobo / 100).toLocaleString("en-NG");

/** Shrinks a picked picture to a JPEG data URL that fits the upload limit. */
async function prepare(file) {
  const bmp = await createImageBitmap(file), cv = document.createElement("canvas");
  for (const [max, q] of [[1280, 0.85], [1100, 0.78], [900, 0.7], [720, 0.6]]) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height)); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL("image/jpeg", q); if ((url.length * 3) / 4 < BILLBOARD.MAX_IMAGE_BYTES * 0.95) return url;
  }
  throw new Error("big");
}

function Picker({ pic, onPick, label }) {
  const ref = useRef(null);
  return (<div className="bbp-pick">
    <button type="button" className="ghost" onClick={() => ref.current?.click()}><Icon name="upload" /> {pic ? "Change picture" : label}</button>
    <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { onPick(await prepare(f)); } catch { toast.error("We could not use that picture. Try a smaller JPG or PNG."); } }} />
    {pic && <img src={pic} alt="Your poster preview" className="bbp-prev" />}
  </div>);
}

export default function BillboardPanel({ board, state, onChanged }) {
  const router = useRouter(), b = state?.boards?.find((x) => x.n === board), [sel, setSel] = useState([]), [whole, setWhole] = useState(false), [pic, setPic] = useState(null), [caption, setCaption] = useState(""), [busy, setBusy] = useState(false), [order, setOrder] = useState(null), [tick, setTick] = useState(0);
  useEffect(() => { setSel([]); setWhole(false); setPic(null); setCaption(""); setOrder(null); }, [board]);
  useEffect(() => { const t = setInterval(() => setTick((v) => v + 1), 500); return () => clearInterval(t); }, []);
  const mine = useMemo(() => new Map((b?.mine ?? []).map((m) => [m.slot, m])), [b]);
  if (!b) return <p className="mut">Loading billboard…</p>;
  const count = whole ? BILLBOARD.SLOTS : sel.length, total = whole ? BILLBOARD.WHOLE_KOBO : sel.length * BILLBOARD.SLOT_KOBO, shown = b.posters.length ? b.posters[Math.floor(Date.now() / 1000 / (state?.seconds ?? 15)) % b.posters.length] : null, left = Math.ceil((state?.seconds ?? 15) - ((Date.now() / 1000) % (state?.seconds ?? 15)));
  const guard = (res) => { if (res.status === 401) { loggedOut(router); return true; } if (res.failed) { notifyError(res); if (res.status === 409) onChanged?.(); return true; } return false; };
  const toggle = (s) => { setWhole(false); setSel((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s].sort((a, c) => a - c))); };
  const reserve = async () => { if (!pic) { toast.error("Add your poster picture first."); return; } setBusy(true); const r = await call("/api/billboards", { action: "reserve", board, slots: sel, whole, caption, image: pic }); setBusy(false); if (guard(r)) return; setOrder(r); onChanged?.(); };
  const pay = async () => { setBusy(true); const r = await call("/api/billboards", { action: "pay", orderId: order.orderId }); setBusy(false); if (guard(r)) return; toast.success("Your poster is live on the billboard."); setOrder(null); setSel([]); setWhole(false); setPic(null); setCaption(""); onChanged?.(); };
  const cancel = async () => { setBusy(true); await call("/api/billboards", { action: "cancel", orderId: order.orderId }); setBusy(false); setOrder(null); onChanged?.(); };
  const change = async (slot, image) => { setBusy(true); const r = await call("/api/billboards", { action: "poster", board, slot, image, caption: mine.get(slot)?.caption ?? "" }); setBusy(false); if (guard(r)) return; toast.success("Poster updated."); onChanged?.(); };
  const minsLeft = order ? Math.max(0, Math.ceil((new Date(order.holdUntil) - Date.now()) / 60000)) : 0; void tick;

  return (<div className="bbp">
    <p className="bbp-badge"><Icon name="lock" size={14} /> Real money (naira), not in-game cash</p>
    <div className="bbp-now" aria-live="polite">
      {shown ? (<><img src={shown.url} alt={shown.caption || "Poster now showing"} /><div><b>Now showing</b><span>{shown.caption || "Spot " + shown.slot}</span><span className="bbp-bar"><i style={{ width: `${(left / (state?.seconds ?? 15)) * 100}%` }} /></span></div></>)
        : <div><b>Nothing showing yet</b><span>Be the first poster on this billboard.</span></div>}
    </div>
    <p className="mut bbp-line">{b.free} of {BILLBOARD.SLOTS} spots free · each poster shows for {state?.seconds ?? BILLBOARD.SECONDS} seconds · {N(BILLBOARD.SLOT_KOBO)} a spot</p>

    {!order && (<>
      <div className="bbp-grid" role="group" aria-label="Poster spots">
        {Array.from({ length: BILLBOARD.SLOTS }, (_, i) => i + 1).map((s) => { const free = b.freeSlots.includes(s), m = mine.get(s), on = whole || sel.includes(s);
          return (<button key={s} type="button" className={"bbp-slot" + (on ? " on" : "") + (m ? " mine" : "")} disabled={!free || busy} aria-pressed={free ? on : undefined} aria-label={`Spot ${s}: ${free ? "free" : m ? (m.status === "PAID" ? "yours" : "held for you") : "sold"}`} onClick={() => toggle(s)}>
            <b>{s}</b><span>{free ? "Free" : m ? (m.status === "PAID" ? "Yours" : "Held") : "Sold"}</span></button>); })}
      </div>
      <div className="row bbp-actions">
        <button type="button" className={"ghost" + (whole ? " on" : "")} disabled={!b.canBuyWhole || busy} aria-pressed={whole} onClick={() => { setWhole((v) => !v); setSel([]); }}>
          <Icon name="billboard" /> Whole billboard · {N(BILLBOARD.WHOLE_KOBO)}</button>
      </div>
      {!b.canBuyWhole && <p className="mut bbp-line">The whole billboard is only for sale while every spot is still free.</p>}
      {count > 0 && (<div className="bbp-buy">
        <Picker pic={pic} onPick={setPic} label="Upload your poster" />
        <input type="text" value={caption} maxLength={BILLBOARD.CAPTION_MAX} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)" aria-label="Poster caption" />
        <button type="button" className="go" disabled={busy || !pic} onClick={reserve}>{whole ? "Reserve the whole billboard" : `Reserve ${count} spot${count > 1 ? "s" : ""}`} · {N(total)}</button>
        {whole && <p className="mut bbp-line">You get every spot. Your poster shows by itself, and you can add a different poster to each spot afterwards.</p>}
      </div>)}
    </>)}

    {order && (<div className="bbp-buy">
      <p><b>{order.whole ? "Whole billboard" : `Spot${order.slots.length > 1 ? "s" : ""} ${order.slots.join(", ")}`}</b> held for you for {minsLeft} more minute{minsLeft === 1 ? "" : "s"}.</p>
      {state?.testPayments
        ? <button type="button" className="go" disabled={busy} onClick={pay}>Pay {N(order.amountKobo)} (test payment)</button>
        : <button type="button" className="go" disabled>Pay {N(order.amountKobo)} · payments not switched on yet</button>}
      {state?.testPayments && <p className="mut bbp-line">Test mode: no real money moves yet. The real payment is connected later.</p>}
      <button type="button" className="ghost" disabled={busy} onClick={cancel}>Cancel reservation</button>
    </div>)}

    {b.mine.some((m) => m.status === "PAID") && (<div className="bbp-mine"><h3>Your posters here</h3>
      {b.mine.filter((m) => m.status === "PAID").map((m) => (<div key={m.slot} className="bbp-row"><span>Spot {m.slot}{m.hasPoster ? "" : " (no picture yet)"}</span>
        <Picker pic={null} label={m.hasPoster ? "Change picture" : "Add picture"} onPick={(img) => change(m.slot, img)} /></div>))}</div>)}
  </div>);
}