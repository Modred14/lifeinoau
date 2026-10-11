// src/app/parties/page.js
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";

export default function Parties() {
  const router = useRouter(), [d, setD] = useState(null), [busy, setBusy] = useState(""), outage = useRef(false);
  const load = useCallback(async () => { const r = await call("/api/parties"); if (r.status === 401) return loggedOut(router);
    if (r.failed) { if (!outage.current) { outage.current = true; notifyError(r); } return; } // this screen polls: tell the player once per outage
    outage.current = false; setD(r); }, [router]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]); // attendance changes as others buy tickets

  async function go(venue) {
    if (busy) return; setBusy(venue);
    const r = await call("/api/parties", { venue, requestId: crypto.randomUUID() }); setBusy("");
    if (r.status === 401) return loggedOut(router);
    if (r.failed) notifyError(r); else if (r.duplicate) toast.info("Already done.");
    else toast.success(`${r.title}${r.note ? " " + r.note : ""}${BigInt(r.extraKobo) > 0n ? ` It cost you ${naira(r.extraKobo)} extra.` : ""}`);
    load();
  }
  return (<>
    <div className="top"><h2>Parties</h2><a href="/play"><button>Back to game</button></a></div>
    <p className="mut">Week {d?.week}. One night out per game week. New lineups every week.</p>
    {!d && <p className="mut">Loading...</p>}
    {d?.parties.map((p) => { const full = p.attendees >= p.capacity, pct = Math.min(100, Math.round((p.attendees / p.capacity) * 100));
      return (<div className="card" key={p.venue}>
        <div className="top"><h2>🔥 {p.venue}</h2><span className="cash">{naira(p.priceKobo)}</span></div>
        <p>{p.theme} · {p.headliner}<br /><span className="mut">{p.night}</span></p>
        <div className="top"><span className="mut">{p.attendees} of {p.capacity} students attending</span><span className="mut">{pct}%</span></div>
        <div className="bar" aria-hidden="true"><i style={{ width: pct + "%", background: full ? "var(--bad)" : "var(--ok)" }} /></div>
        <button className="go" style={{ width: "100%", marginTop: 10 }} disabled={!!busy || d.wentOut || full} onClick={() => go(p.venue)}>
          {p.going ? "You're going ✔" : full ? "Sold out" : d.wentOut ? "You already went out this week" : busy === p.venue ? "Getting in..." : "Buy ticket and go"}</button></div>); })}
  </>);
}